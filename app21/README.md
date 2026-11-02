# app21

The same app as [`app/`](../app/), on Angular 21.2.26 (`@angular/ssr` 21.2.29).
`src/` and `angular.json` are byte-identical. `package.json`, the lockfile and
`tsconfig.json` are different, because v21's scaffold writes `strict` and
`strictTemplates` and v22 relies on the defaults.

I added it because Angular 21 supports `^20.19.0 || ^22.12.0 || >=24.0.0`, and on
Node 20 and on 22 before 22.18.0 Angular's own lazy `import()` calls are enough to
leak, without any shared state in the app. Angular 22 requires newer versions than
that.

```bash
cd app21
npm ci
npx ng build
npx ng build --configuration zoneless
cd ..
node tools/matrix.mjs app21 profile /path/to/node-22.17.1
```

For the patched column, copy [`fix/zone-node.mjs`](../fix/zone-node.mjs) over
`app21/node_modules/zone.js/fesm2015/zone-node.js` and run
`npx ng build --output-path dist/patched`. Check that
`grep -c getBuiltinModule dist/patched/server/polyfills.server.mjs` prints 1, put
the original file back, and pass `--patched` to `tools/matrix.mjs`.
