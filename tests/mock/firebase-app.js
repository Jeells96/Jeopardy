// Test stand-in for firebase-app.js (see tests/server.js).
export function initializeApp(options) {
  return { options, name: "[mock]" };
}
