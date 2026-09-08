import { defineConfig } from 'vite';

// base musi odpowiadać nazwie repo na GitHub Pages (https://<user>.github.io/stair3d/),
// inaczej zbudowane assety (JS/CSS) będą się ładować spod złych ścieżek i strona zostanie pusta.
export default defineConfig({
  base: '/stair3d/',
});
