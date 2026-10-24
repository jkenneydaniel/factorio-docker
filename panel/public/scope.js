// Explicit URL scope lets several server tabs coexist without selection cookies.
const prefix =
  location.pathname.match(
    /^(?:\/hosts\/[a-f0-9]{32})?\/servers\/[a-f0-9]{32}(?=\/|$)/,
  )?.[0] || '';
export const serverPath = (value) => prefix + value;
export const pagePath = (hash = '') => serverPath('/') + hash;
