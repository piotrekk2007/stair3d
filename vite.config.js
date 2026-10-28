import { defineConfig, build } from 'vite';
import { fileURLToPath } from 'node:url';

// The client's 3D viewer (src/viewer/clientViewer.js) bundled ON ITS OWN — one IIFE with three.js inside — and served
// to the designer as a string (`import runtime from 'virtual:client-viewer-runtime'`), which export/clientModelExport.js
// pastes into the HTML file the client gets: that file carries this viewer only, never the designer's code.
const VIEWER_ID = 'virtual:client-viewer-runtime';
function clientViewerRuntime() {
  return {
    name: 'client-viewer-runtime',
    resolveId(id) {
      return id === VIEWER_ID ? `\0${VIEWER_ID}` : null;
    },
    async load(id) {
      if (id !== `\0${VIEWER_ID}`) return null;
      const entry = fileURLToPath(new URL('./src/viewer/clientViewer.js', import.meta.url));
      this.addWatchFile(entry);
      const out = await build({
        configFile: false,
        logLevel: 'warn',
        build: {
          write: false,
          minify: true,
          emptyOutDir: false,
          lib: { entry, formats: ['iife'], name: 'StairClientViewer', fileName: () => 'client-viewer.js' },
        },
      });
      const result = Array.isArray(out) ? out[0] : out;
      const chunk = result.output.find((o) => o.type === 'chunk');
      return `export default ${JSON.stringify(chunk.code)};`;
    },
  };
}

// base musi odpowiadać nazwie repo na GitHub Pages (https://<user>.github.io/stair3d/),
// inaczej zbudowane assety (JS/CSS) będą się ładować spod złych ścieżek i strona zostanie pusta.
export default defineConfig({
  base: '/stair3d/',
  plugins: [clientViewerRuntime()],
});
