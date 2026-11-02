import { Routes } from '@angular/router';
import HomePage from './home/home';
import SettingsPage from './settings/settings';
import { accountResolver } from './account/account.resolver';

export const routes: Routes = [
  // Loads its own data per request, and defers a panel.
  { path: '', pathMatch: 'full', component: HomePage },
  // Defers the same panel, and loads nothing.
  { path: 'settings', component: SettingsPage },
  // Lazy, and reads the identity in a resolver.
  {
    path: 'account',
    loadComponent: () => import('./account/account'),
    resolve: { account: accountResolver },
  },
  // Lazy, and reads the identity inside the component.
  { path: 'profile', loadComponent: () => import('./profile/profile') },
];
