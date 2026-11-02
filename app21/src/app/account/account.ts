import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AccountView } from './account.resolver';

@Component({
  selector: 'app-account',
  template: `
    <dl>
      <dt>logged in as (inject(REQUEST))</dt><dd id="trueUser">{{ view.trueUser }}</dd>
      <dt>logged in as (the ambient async context)</dt><dd id="alsUser">{{ view.alsUser }}</dd>
      <dt>account returned by the API</dt><dd id="user">{{ view.account.user }}</dd>
      <dt>email</dt><dd id="email">{{ view.account.email }}</dd>
      <dt>iban</dt><dd id="iban">{{ view.account.iban }}</dd>
      <dt>balance</dt><dd id="balance">{{ view.account.balance }}</dd>
    </dl>
  `,
})
export default class AccountPage {
  protected readonly view = inject(ActivatedRoute).snapshot.data['account'] as AccountView;
}
