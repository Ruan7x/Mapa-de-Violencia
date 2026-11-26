/* Configure o provedor aqui. O servidor público OSM é destinado a uso moderado.
   Preserve a atribuição, o Referer e o cache HTTP; não faça download em massa. */
window.MAP_CONFIG = Object.freeze({
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
});
