// Serviços públicos consultados apenas por ação do visitante.
window.Civic = (() => {
  const byId = id => document.getElementById(id);
  const nearMeters = 250;
  const alertCount = 3;

  // Distância em um plano tangente local, suficiente para os trechos urbanos desta área.
  function nearSegment(record, a, b) {
    const xScale = 111320 * Math.cos(record.lat * Math.PI / 180);
    const ax = (a[0] - record.lng) * xScale;
    const ay = (a[1] - record.lat) * 111320;
    const dx = (b[0] - a[0]) * xScale;
    const dy = (b[1] - a[1]) * 111320;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0;
    return Math.hypot(ax + t * dx, ay + t * dy) <= nearMeters;
  }

  function score(path, records) {
    return records.filter(record => record.status !== 'inativo' &&
      path.some((point, i) => i > 0 && nearSegment(record, path[i - 1], point))).length;
  }

  function routes(map, bairros, position, records, toast) {
    const places = [...bairros, {nome:'Centro de Várzea Grande', lng:-56.1325, lat:-15.6467}];
    const from = byId('routeFrom'), to = byId('routeTo'), message = byId('routeMessage');
    from.add(new Option('Minha localização', 'gps'));
    places.forEach((p, index) => {
      from.add(new Option(p.nome, index));
      to.add(new Option(p.nome, index));
    });
    from.value = '0';
    to.value = '1';
    let pending, audio, results = [], selected = 0, insideCluster = false;
    const sourceId = 'rotas-de-carro';
    function reset() {
      pending?.abort();
      pending = null;
      results = [];
      insideCluster = false;
      byId('routeOptions').replaceChildren();
      byId('clearRoute').hidden = true;
      message.textContent = '';
      if(map.getLayer(sourceId)) map.removeLayer(sourceId);
      if(map.getSource(sourceId)) map.removeSource(sourceId);
    }
    function tone() {
      if(!byId('routeSound').checked || audio?.state !== 'running') return;
      const oscillator = audio.createOscillator(), gain = audio.createGain();
      oscillator.connect(gain).connect(audio.destination);
      oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(0.09, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.25);
      oscillator.start(); oscillator.stop(audio.currentTime + 0.26);
    }
    function selectRoute(index) {
      selected = index;
      insideCluster = false;
      const route = results[index];
      const best = results.reduce((winner, item) => item.count < winner.count ? item : winner);
      const data = {type:'Feature', properties:{}, geometry:route.geometry};
      if(map.getSource(sourceId)) map.getSource(sourceId).setData(data);
      else {
        map.addSource(sourceId, {type:'geojson', data});
        map.addLayer({id:sourceId, type:'line', source:sourceId, paint:{'line-color':'#176fd1','line-width':5,'line-opacity':0.86}});
      }
      const bounds = new maplibregl.LngLatBounds();
      route.geometry.coordinates.forEach(point => bounds.extend(point));
      map.fitBounds(bounds, {padding:45, maxZoom:16, duration:350});
      [...byId('routeOptions').children].forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
      const high = route.count >= alertCount;
      const alternative = best.count < route.count ? ' Considere o percurso '+(results.indexOf(best)+1)+', com '+best.count+' registro(s).' :
        ' Nenhuma opção retornada tem menos registros.';
      message.textContent = 'Percurso '+(index+1)+' · '+route.count+' ocorrência(s) fictícia(s) a até 250 m.' + (high ? alternative : '');
      if(high) {
        toast('Alerta simulado. '+message.textContent, 'warning');
        tone();
      }
    }
    async function calculate() {
      reset();
      const origin = from.value === 'gps' ? position() : places[Number(from.value)];
      const destination = places[Number(to.value)];
      if(!origin) { message.textContent = 'Ative a localização com sinal de GPS ou escolha uma partida.'; return; }
      if(origin === destination) { message.textContent = 'Escolha um destino diferente da partida.'; return; }
      if(byId('routeSound').checked) {
        try { const Sound = window.AudioContext || window.webkitAudioContext; audio ||= new Sound(); audio.resume().catch(()=>{}); } catch {}
      }
      const controller = new AbortController();
      pending = controller;
      const timer = setTimeout(()=>controller.abort(), 15000);
      message.textContent = 'Consultando percursos de carro…';
      try {
        const points = [origin,destination].map(p=>p.lng.toFixed(5)+','+p.lat.toFixed(5)).join(';');
        const response = await fetch('https://router.project-osrm.org/route/v1/driving/'+points+'?alternatives=true&overview=full&geometries=geojson&steps=true', {signal:controller.signal});
        if(!response.ok) throw Error();
        const payload = await response.json();
        if(pending !== controller) return;
        if(payload.code !== 'Ok' || !payload.routes?.length) { message.textContent = 'Nenhum percurso encontrado entre esses pontos.'; return; }
        results = payload.routes.filter(r=>r.geometry?.type==='LineString' && r.geometry.coordinates.length>=2)
          .map(r=>({...r,count:score(r.geometry.coordinates,records())}));
        if(!results.length) throw Error();
        results.forEach((r,i)=>{
          const button = document.createElement('button');
          const streets = [...new Set(r.legs.flatMap(leg=>leg.steps || []).map(step=>step.name).filter(Boolean))];
          button.textContent = 'Percurso '+(i+1)+' · '+(r.distance/1000).toFixed(1).replace('.',',')+' km · '+r.count+' registro(s)' + (streets.length ? ' · via '+streets.slice(0,2).join(' e ') : '');
          button.onclick = ()=>selectRoute(i);
          byId('routeOptions').append(button);
        });
        byId('clearRoute').hidden = false;
        selectRoute(0);
      } catch {
        if(pending === controller) message.textContent = 'O serviço de rotas está indisponível. Tente novamente.';
      } finally { clearTimeout(timer); }
    }
    from.onchange = to.onchange = reset;
    byId('calculateRoute').onclick = calculate;
    byId('clearRoute').onclick = reset;
    function moved(pos) {
      const route = results[selected];
      if(!route) return;
      const close = score(route.geometry.coordinates,[pos]) > 0;
      const point = [pos.lng,pos.lat];
      const nearby = close ? score([point,point],records()) : 0;
      if(nearby >= alertCount && !insideCluster) {
        const alternative = results.findIndex(r=>r.count < route.count);
        const advice = alternative < 0 ? 'Consulte as opções antes de continuar.' : 'Considere o percurso '+(alternative+1)+'.';
        const text = 'Simulação: '+nearby+' registros a até 250 m da sua posição. '+advice;
        message.textContent = text;
        toast(text,'warning');
        tone();
      }
      insideCluster = nearby >= alertCount;
    }
    return {moved,locationOff(){ insideCluster=false; if(from.value === 'gps') reset(); }};
  }

  function normalize(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }
  function cityMatch(person, city) {
    const occurrence = person.ultimaOcorrencia;
    if(!occurrence || occurrence.dtLocalizacao) return false;
    const place = normalize(occurrence.localDesaparecimentoConcat).replace(/[().]/g, ' ').trim();
    // O município encerra o endereço concatenado, seguido opcionalmente da UF.
    const suffix = new RegExp('(?:^|[,;:/|–—-]\\s*)'+normalize(city)+'(?:\\s*[-,/()]?\\s*mt\\)?)?\\s*$');
    return suffix.test(place);
  }

  // ---------- Pessoas desaparecidas (API pública da Polícia Civil de MT) ----------
  const MISSING_API = 'https://abitus-api.pjc.mt.gov.br/v1/pessoas/aberto/filtro?';
  const ROTATE_MS = 7000;   // tempo de cada pessoa no aviso flutuante
  const AUTO_PAGES = 9;     // o aviso busca sozinho no máximo estas páginas; o resto fica na galeria

  function stillMissing(person, cities) {
    return Boolean(person?.ultimaOcorrencia && !person.ultimaOcorrencia.dtLocalizacao &&
      (!cities.length || cities.some(c=>cityMatch(person,c))));
  }
  async function missingPage(page, signal) {
    const params = new URLSearchParams({faixaIdadeInicial:'0',faixaIdadeFinal:'0',nome:'',sexo:'',status:'DESAPARECIDO',pagina:String(page),porPagina:'50'});
    const response = await fetch(MISSING_API+params,{signal,cache:'no-store'});
    if(!response.ok) throw Error();
    const data = await response.json();
    if(!Array.isArray(data.content)) throw Error();
    return {content:data.content, hasMore: typeof data.last === 'boolean' ? !data.last : page + 1 < data.totalPages};
  }
  function photoUrl(person) {
    try {
      const url = new URL(person.urlFoto);
      return url.protocol === 'https:' ? url.href : '';
    } catch { return ''; }
  }
  // "THAMIRYS VITORIA DE ARRUDA" -> "Thamirys Vitoria de Arruda" (só para exibir no aviso).
  const NAME_PARTICLES = new Set(['da','das','de','do','dos','e']);
  function displayName(value) {
    const name = String(value || '').trim();
    if(!name) return 'Nome não informado';
    return name.toLocaleLowerCase('pt-BR').split(/\s+/).map((word, i)=>
      i > 0 && NAME_PARTICLES.has(word) ? word : word.charAt(0).toLocaleUpperCase('pt-BR')+word.slice(1)).join(' ');
  }
  // "2026-10-02T00:00:00" -> "02/10/2026" sem passar pelo fuso horário.
  function shortDate(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    return m ? m[3]+'/'+m[2]+'/'+m[1] : '';
  }

  function missingList(prefix, cities = []) {
    const field = suffix=>byId(prefix+suffix);
    const list = field('Results'), status = field('Status'), more = field('More');
    const retry = field('Retry');
    let next = 0, pending, shown = new Set();
    function reset() {
      pending?.abort(); pending = null; next = 0; shown.clear(); list.replaceChildren();
      more.hidden = true; status.textContent = '';
    }
    function append(person) {
      if(shown.has(person.id)) return;
      shown.add(person.id);
      const card = document.createElement('article'), title = document.createElement('strong');
      const src = photoUrl(person);
      if(src) {
        const image = new Image(); image.loading = 'lazy'; image.alt = 'Foto divulgada de '+(person.nome || 'pessoa desaparecida'); image.src = src;
        image.onerror = ()=>image.remove();
        card.append(image);
      }
      title.textContent = person.nome || 'Nome não informado';
      card.append(title);
      list.append(card);
    }
    async function load(restart) {
      if(restart) reset();
      if(pending) return;
      const controller = new AbortController();
      pending = controller;
      const timer = setTimeout(()=>controller.abort(),15000);
      retry.hidden = true;
      more.hidden = true; status.textContent = 'Consultando a Polícia Civil de MT…';
      try {
        // Busca incremental na listagem estadual. Nunca presume município ausente.
        const initialCount = shown.size;
        let hasMore = false;
        for(let pages = 0; pages < 3; pages++){
          const page = await missingPage(next, controller.signal);
          if(pending !== controller) return;
          page.content.filter(p=>stillMissing(p,cities)).forEach(append);
          next++;
          hasMore = page.hasMore;
          if(!hasMore || shown.size > initialCount) break;
        }
        more.hidden = !hasMore;
        status.textContent = shown.size ? '' :
          (hasMore ? 'Nenhuma ficha local nestas páginas.' : 'Nenhuma ficha encontrada para esta consulta.');

      } catch {
        if(pending === controller) {
          status.textContent = 'Não foi possível consultar a API. Tente novamente ou abra o portal oficial.';
          retry.hidden = false;
        }
      } finally { clearTimeout(timer); if(pending===controller) pending=null; }
    }
    more.onclick = retry.onclick = ()=>load(false);
    return {refresh:()=>load(true),reset};
  }

  // Aviso flutuante (pop-up de notificação): uma pessoa por vez, trocando a cada ROTATE_MS.
  // O tempo é a própria animação da barra de progresso: quando ela termina, passa para a
  // próxima pessoa. Assim, pausar a barra (mouse em cima, foco do teclado, galeria aberta)
  // pausa a troca sem precisar de outro relógio. O ✕ esconde o aviso de vez.
  function missingNotice(cities) {
    const box = byId('missingSection'), slide = byId('missingSlide'), status = byId('missingStatus');
    const retry = byId('missingRetry'), progress = byId('missingProgress');
    const closeButton = byId('missingClose'), reopen = byId('missingReopen');
    const people = [], seen = new Set();
    let index = 0, next = 0, hasMore = false, pending = null, open = false;
    box.style.setProperty('--mn-ms', ROTATE_MS+'ms');

    // Altura ocupada pelo aviso (no celular, a legenda dos trajetos sobe acima dele).
    function measure() {
      document.documentElement.style.setProperty('--missing-height', open ? box.offsetHeight+'px' : '0px');
    }
    if(typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(box);

    // Reinicia a barra de 7 s, ou a remove quando não há para onde trocar.
    function restartTimer() {
      const rotates = open && (people.length > 1 || (people.length === 1 && hasMore && next < AUTO_PAGES));
      progress.replaceChildren(...(rotates ? [document.createElement('i')] : []));
    }

    function noPhoto(frame) {
      frame.replaceChildren();
      frame.classList.add('empty');
      frame.setAttribute('role','img');
      frame.setAttribute('aria-label','Sem foto divulgada');
    }

    function render(i) {
      index = i;
      const person = people[i];
      const name = displayName(person.nome);
      const card = document.createElement('figure');
      card.className = 'mn-person';
      card.setAttribute('role','group');
      card.setAttribute('aria-roledescription','pessoa');
      card.setAttribute('aria-label',(i+1)+' de '+people.length);

      const frame = document.createElement('div');
      frame.className = 'mn-photo';
      const src = photoUrl(person);
      if(src) {
        // A mesma foto, desfocada, preenche o fundo do quadro; a nítida aparece inteira por cima.
        const backdrop = new Image(); backdrop.className = 'mn-photo-bg'; backdrop.alt = ''; backdrop.src = src;
        const image = new Image(); image.alt = 'Foto divulgada de '+name; image.src = src;
        image.onerror = ()=>noPhoto(frame);
        frame.append(backdrop, image);
      } else noPhoto(frame);

      const caption = document.createElement('figcaption');
      const title = document.createElement('strong');
      title.textContent = name; title.title = name;
      caption.append(title);
      const age = Number.isFinite(person.idade) && person.idade > 0 ? person.idade+(person.idade === 1 ? ' ano' : ' anos') : '';
      const city = cities.find(c=>cityMatch(person,c)) || '';
      const since = shortDate(person.ultimaOcorrencia?.dtDesaparecimento);
      const label = person.sexo === 'FEMININO' ? 'Desaparecida desde ' : person.sexo === 'MASCULINO' ? 'Desaparecido desde ' : 'Desaparecimento em ';
      // Na tela fica só o nome; idade, cidade e data aparecem ao passar o mouse
      // e são lidas pelo leitor de tela.
      const full = [age, city, since && label+since].filter(Boolean).join(' · ');
      if(full) {
        const spoken = document.createElement('span');
        spoken.className = 'mn-sr'; spoken.textContent = full;
        caption.append(spoken);
        title.title = name+' · '+full;
      }

      card.append(frame, caption);
      slide.replaceChildren(card);
      restartTimer();
      // Carrega a próxima foto antes da troca, para ela não aparecer pela metade.
      const upcoming = people[(i+1) % people.length];
      if(upcoming && upcoming !== person && photoUrl(upcoming)) new Image().src = photoUrl(upcoming);
    }

    // quiet: busca de fundo durante a rotação, sem mensagens na tela.
    async function load(quiet) {
      if(pending) return;
      const controller = new AbortController();
      pending = controller;
      const timer = setTimeout(()=>controller.abort(),15000);
      if(!quiet) { retry.hidden = true; status.textContent = 'Consultando a Polícia Civil de MT…'; }
      const before = people.length;
      try {
        for(let pages = 0; pages < 3; pages++){
          const page = await missingPage(next, controller.signal);
          page.content.filter(p=>stillMissing(p,cities)).forEach(p=>{
            if(seen.has(p.id)) return;
            seen.add(p.id); people.push(p);
          });
          next++;
          hasMore = page.hasMore;
          if(!hasMore || people.length > before) break;
        }
        if(!quiet) status.textContent = people.length ? '' :
          (hasMore ? 'Nenhuma ficha local nas primeiras páginas. Veja a galeria completa.' : 'Nenhuma ficha encontrada para esta consulta.');
      } catch {
        if(quiet) hasMore = false; // não insiste em segundo plano
        else {
          status.textContent = 'Não foi possível consultar a API. Tente novamente ou abra o portal oficial.';
          retry.hidden = false;
        }
      } finally { clearTimeout(timer); pending = null; }
    }

    async function advance() {
      if(!open || !people.length) return;
      if(index + 1 >= people.length && hasMore && next < AUTO_PAGES) await load(true);
      if(!open) return;
      const target = index + 1 < people.length ? index + 1 : 0;
      if(target === index) return restartTimer();
      render(target);
    }
    progress.addEventListener('animationend', event=>{ if(event.animationName === 'mnProgress') advance(); });

    function show() {
      open = true;
      reopen.hidden = true;
      box.classList.add('show');
      restartTimer();
      measure();
    }
    function hide() {
      const hadFocus = box.contains(document.activeElement);
      open = false;
      box.classList.remove('show');
      restartTimer();
      measure();
      reopen.hidden = false;
      if(hadFocus) reopen.focus();
    }
    closeButton.onclick = hide;
    reopen.onclick = ()=>{
      const byKeyboard = reopen.matches(':focus-visible');
      show();
      if(byKeyboard) closeButton.focus();
    };
    retry.onclick = async ()=>{
      await load(false);
      if(people.length) render(0);
    };

    return (async ()=>{
      await load(false);
      if(people.length) render(0);
      show(); // o aviso "salta" na tela quando a consulta termina
    })();
  }

  function missing(){
    const popup = missingList('popup');
    const dialog = byId('missingDialog');
    byId('openMissingDialog').onclick = ()=>{
      dialog.showModal();
      return popup.refresh();
    };
    dialog.onclose = popup.reset;
    return missingNotice(['Cuiabá','Várzea Grande']);
  }
  return {routes,missing,cityMatch,score};
})();
