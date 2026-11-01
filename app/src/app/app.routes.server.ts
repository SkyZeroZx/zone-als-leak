import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    // Per request. Prerender (the scaffold default) is static: no logged-in user.
    renderMode: RenderMode.Server,
  },
];
