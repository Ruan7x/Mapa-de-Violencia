/* Camadas e marcadores nativos do MapLibre. Sem Leaflet ou plugin de integração. */
(function(){
  'use strict';
  const coordinates = p => Array.isArray(p) ? [p[1],p[0]] : [p.lng,p.lat];
  const collection = features => ({type:'FeatureCollection', features});
  class MarkerGroup {
    constructor(map, visible=true){ this.map=map; this.visible=visible; this.markers=[]; }
    addLayer(marker){ this.markers.push(marker); if(this.visible) marker.addTo(this.map); return this; }
    clearLayers(){ this.markers.forEach(m=>m.remove()); this.markers=[]; }
    addTo(){ this.visible=true; this.markers.forEach(m=>m.addTo(this.map)); return this; }
    remove(){ this.visible=false; this.markers.forEach(m=>m.remove()); return this; }
  }
  function marker(map, point, options){
    const element=document.createElement('div');
    element.className='map-marker '+(options.className||'');
    element.innerHTML=options.html;
    element.title=options.title||'';
    element.setAttribute('role','button'); element.tabIndex=0;
    element.setAttribute('aria-label',options.title||'Ver detalhes');
    const click=e=>{ e.stopPropagation(); if(options.onClick) options.onClick(); };
    element.addEventListener('click',click);
    element.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); click(e); } });
    return new maplibregl.Marker({element,anchor:options.anchor||'center'})
      .setLngLat(coordinates(point));
  }
  function userMarker(map, point, color, onClick){
    const m=marker(map,point,{html:'<span class="user-dot"></span>',className:'user-marker',title:'Você está aqui',onClick});
    m.setLatLng=p=>{ m.setLngLat(coordinates(p)); return m; };
    m.setStyle=style=>{ m.getElement().style.setProperty('--dot-color',style.fillColor); return m; };
    return m.setStyle({fillColor:color}).addTo(map);
  }
  class HeatLayer {
    constructor(map, colors, opacity){
      this.map=map;
      map.addSource('occ-heat',{type:'geojson',data:collection([])});
      map.addLayer({id:'occ-heat',type:'heatmap',source:'occ-heat',paint:{
        'heatmap-radius':['interpolate',['linear'],['zoom'],10,18,16,32],
        'heatmap-weight':1, 'heatmap-intensity':0.8
      }});
      this.setCores(colors,opacity);
    }
    setPoints(points){ this.map.getSource('occ-heat').setData(collection(points.map(p=>({type:'Feature',properties:{},geometry:{type:'Point',coordinates:[p.lng,p.lat]}})))); }
    setCores(colors, opacity){
      this.map.setPaintProperty('occ-heat','heatmap-color',['interpolate',['linear'],['heatmap-density'],0,'rgba(0,0,0,0)',0.15,colors[0],0.4,colors[1],0.72,colors[2],1,colors[3]]);
      this.map.setPaintProperty('occ-heat','heatmap-opacity',opacity);
    }
  }
  let circleId=0;
  class Circle {
    constructor(map, point, options){
      this.map=map; this.point=point; this.options=options; this.id='geo-circle-'+(++circleId);
      map.addSource(this.id,{type:'geojson',data:this.data()});
      map.addLayer({id:this.id+'-fill',type:'fill',source:this.id,paint:{'fill-color':options.fillColor,'fill-opacity':options.fillOpacity}});
      if(options.color) map.addLayer({id:this.id+'-line',type:'line',source:this.id,paint:{'line-color':options.color,'line-width':1.5,'line-dasharray':options.dashArray||[1,0]}});
    }
    data(){
      const [lng,lat]=coordinates(this.point), ring=[], distance=this.options.radius/6371000;
      const latR=lat*Math.PI/180, lngR=lng*Math.PI/180;
      for(let i=0;i<=64;i++){
        const bearing=i*2*Math.PI/64;
        const y=Math.asin(Math.sin(latR)*Math.cos(distance)+Math.cos(latR)*Math.sin(distance)*Math.cos(bearing));
        const x=lngR+Math.atan2(Math.sin(bearing)*Math.sin(distance)*Math.cos(latR),Math.cos(distance)-Math.sin(latR)*Math.sin(y));
        ring.push([x*180/Math.PI,y*180/Math.PI]);
      }
      return {type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[ring]}};
    }
    update(){ this.map.getSource(this.id).setData(this.data()); return this; }
    setLatLng(p){ this.point=p; return this.update(); }
    setRadius(radius){ this.options.radius=radius; return this.update(); }
    setStyle(style){
      Object.assign(this.options,style);
      if(style.fillColor) this.map.setPaintProperty(this.id+'-fill','fill-color',style.fillColor);
      if(style.color && this.map.getLayer(this.id+'-line')) this.map.setPaintProperty(this.id+'-line','line-color',style.color);
      return this;
    }
    remove(){
      for(const suffix of ['-line','-fill']) if(this.map.getLayer(this.id+suffix)) this.map.removeLayer(this.id+suffix);
      if(this.map.getSource(this.id)) this.map.removeSource(this.id);
    }
  }
  window.MapFeatures={MarkerGroup,marker,userMarker,HeatLayer,Circle};
})();
