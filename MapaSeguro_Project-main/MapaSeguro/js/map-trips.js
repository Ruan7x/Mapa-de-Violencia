/* Efeito inspirado no exemplo trips do deck.gl.
   Trajetos locais, esquemáticos e fictícios: NÃO são rotas nem dados de trânsito.
   Para trajetos reais, substitua os caminhos por coordenadas [longitude,latitude]
   e timestamps relativos, em segundos, obtidos da sua fonte de trajetos. */
(function(){
  'use strict';
  const LOOP=120, TRAIL=18;
  const PATHS=[
    [[-56.110,-15.606],[-56.104,-15.602],[-56.099,-15.598],[-56.094,-15.594],[-56.090,-15.589],[-56.087,-15.584],[-56.083,-15.578]],
    [[-56.111,-15.583],[-56.104,-15.585],[-56.097,-15.588],[-56.090,-15.592],[-56.083,-15.595],[-56.076,-15.598],[-56.070,-15.601]],
    [[-56.101,-15.620],[-56.097,-15.614],[-56.093,-15.608],[-56.089,-15.602],[-56.085,-15.596],[-56.081,-15.590],[-56.077,-15.584]]
  ];
  function timedTrip(path, offset, color){
    const distances=[0];
    for(let i=1;i<path.length;i++){
      const dx=(path[i][0]-path[i-1][0])*Math.cos(path[i][1]*Math.PI/180);
      const dy=path[i][1]-path[i-1][1];
      distances.push(distances[i-1]+Math.hypot(dx,dy));
    }
    const total=distances[distances.length-1]||1;
    return {path,timestamps:distances.map(d=>offset+85*d/total),color};
  }
  class MapTrips {
    constructor(map, options={}){
      this.map=map; this.options=options; this.theme=options.theme||'light';
      this.enabled=false; this.paused=false; this.time=0; this.frame=null; this.lastFrame=null; this.overlay=null;
      this.motion=window.matchMedia('(prefers-reduced-motion: reduce)');
      this.onVisibility=()=>this.sync();
      this.onMotion=()=>{ if(this.motion.matches) this.paused=true; this.sync(); };
      document.addEventListener('visibilitychange',this.onVisibility);
      this.motion.addEventListener('change',this.onMotion);
      document.getElementById('btnTripsPause').addEventListener('click',()=>{ this.paused=!this.paused; this.sync(); });
      map.on('remove',()=>this.destroy());
      this.buildData();
    }
    buildData(){
      const colors=this.theme==='dark' ? [[34,211,238],[251,191,36],[167,139,250]] : [[0,119,182],[233,119,0],[109,40,217]];
      // Cópias deslocadas no tempo mantêm o fluxo ao atravessar o início do loop.
      this.data=[];
      PATHS.forEach((path,i)=>{
        for(const start of [i*17-LOOP,i*17,i*17+LOOP]){
          this.data.push(timedTrip(path,start,colors[i]));
          this.data.push(timedTrip([...path].reverse(),start+50,colors[(i+1)%3]));
        }
      });
    }
    setTheme(theme){ this.theme=theme; this.buildData(); if(this.enabled) this.draw(); }
    toggle(){
      if(!this.enabled){
        if(!window.deck || !deck.MapboxOverlay || !deck.TripsLayer){
          this.options.onError('O efeito de trajetos não carregou. Verifique a conexão e recarregue.'); return;
        }
        this.enabled=true; this.paused=this.motion.matches; this.time=45;
        try{
          if(!this.overlay){
            this.overlay=new deck.MapboxOverlay({interleaved:false, layers:[], useDevicePixels:Math.min(window.devicePixelRatio||1,2),
              onError:()=>{ this.enabled=false; this.sync(); this.options.onError('Não foi possível desenhar os trajetos neste navegador.'); }
            });
            this.map.addControl(this.overlay);
          }
        }catch(error){
          console.warn(error); this.enabled=false; this.options.onError('O efeito de trajetos está indisponível neste navegador.');
        }
      }else this.enabled=false;
      this.sync();
    }
    draw(){
      if(!this.overlay) return;
      this.overlay.setProps({layers:this.enabled ? [
        new deck.PathLayer({id:'demo-trips-guide',data:PATHS,getPath:d=>d,getColor:this.theme==='dark'?[148,163,184,65]:[51,65,85,50],getWidth:1,widthUnits:'pixels',pickable:false}),
        new deck.TripsLayer({id:'demo-trips',data:this.data,getPath:d=>d.path,getTimestamps:d=>d.timestamps,
          getColor:d=>d.color,currentTime:this.time,trailLength:TRAIL,fadeTrail:true,
          widthMinPixels:3,capRounded:true,jointRounded:true,pickable:false})
      ]:[]});
    }
    sync(){
      if(this.frame!==null) cancelAnimationFrame(this.frame);
      this.frame=null; this.lastFrame=null;
      const btn=document.getElementById('btnTrips'), pause=document.getElementById('btnTripsPause');
      btn.setAttribute('aria-pressed',String(this.enabled));
      btn.title=this.enabled?'Ocultar trajetos demonstrativos':'Mostrar trajetos demonstrativos';
      btn.setAttribute('aria-label',btn.title);
      document.getElementById('tripsCaption').hidden=!this.enabled;
      pause.textContent=this.paused?'Reproduzir':'Pausar'; pause.setAttribute('aria-pressed',String(this.paused));
      this.draw();
      if(this.enabled&&!this.paused&&!document.hidden) this.frame=requestAnimationFrame(t=>this.animate(t));
    }
    animate(now){
      this.frame=null;
      if(!this.enabled||this.paused||document.hidden) return;
      if(this.lastFrame!==null) this.time=(this.time+Math.min((now-this.lastFrame)/1000,0.1)*7)%LOOP;
      this.lastFrame=now; this.draw();
      this.frame=requestAnimationFrame(t=>this.animate(t));
    }
    destroy(){
      if(this.frame!==null) cancelAnimationFrame(this.frame);
      document.removeEventListener('visibilitychange',this.onVisibility);
      this.motion.removeEventListener('change',this.onMotion);
      if(this.overlay) this.overlay.finalize();
    }
  }
  window.MapTrips=MapTrips;
})();
