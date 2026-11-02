import { HttpInterceptorFn } from '@angular/common/http';
import httpContext from 'express-http-context';

const API_ORIGIN = process.env['API_ORIGIN'] ?? 'http://127.0.0.1:4799';

// Server-only: absolutise the URL and forward this request's credentials.
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = httpContext.get('token') as string | undefined;
  const url = req.url.startsWith('/') ? API_ORIGIN + req.url : req.url;
  return next(
    token
      ? req.clone({ url, setHeaders: { Authorization: `Bearer ${token}` } })
      : req.clone({ url }),
  );
};
