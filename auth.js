/* auth.js — shared authentication guard for notsexyfitness.com */
(function () {
  'use strict';

  // Never run on the login page itself
  if (window.location.pathname.endsWith('/login.html')) return;

  const WHITELIST = ['kharless@gmail.com'];

  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCZ49TDQjIgHoOfna8yHg01W-Tc5D5Eidk',
    authDomain: 'notsexyfitness-72d40.firebaseapp.com',
    projectId: 'notsexyfitness-72d40',
    storageBucket: 'notsexyfitness-72d40.firebasestorage.app',
    messagingSenderId: '1057577322874',
    appId: '1:1057577322874:web:57f0eb89fda9acacf8aec3',
  };

  const LOGIN_URL = window.location.origin + '/login.html';

  // Immediately hide the page so there's no flash of protected content
  const hideStyle = document.createElement('style');
  hideStyle.id = '__auth-hide';
  hideStyle.textContent = 'body { visibility: hidden !important; }';
  document.head.appendChild(hideStyle);

  function reveal() {
    const el = document.getElementById('__auth-hide');
    if (el) el.remove();
  }

  function whenReady(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function showUnauthorized(email) {
    whenReady(() => {
      reveal();
      document.body.innerHTML = `
        <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
          font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f7f8fc">
          <div style="text-align:center;padding:48px 32px;background:#fff;border-radius:16px;
            box-shadow:0 4px 24px rgba(0,0,0,.1);max-width:380px;width:90%">
            <div style="font-size:56px;margin-bottom:16px">&#128683;</div>
            <h2 style="font-size:22px;font-weight:700;color:#1a202c;margin-bottom:8px">Not Authorized</h2>
            <p style="font-size:15px;color:#718096;margin-bottom:24px">
              <strong>${email}</strong> does not have access to this site.
            </p>
            <button onclick="firebase.auth().signOut().then(() => location.reload())"
              style="background:#e53e3e;color:#fff;border:none;border-radius:8px;
                padding:12px 24px;font-size:15px;font-weight:600;cursor:pointer;width:100%">
              Sign Out
            </button>
          </div>
        </div>`;
    });
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  const CDN = 'https://www.gstatic.com/firebasejs/10.12.0';

  loadScript(`${CDN}/firebase-app-compat.js`)
    .then(() => loadScript(`${CDN}/firebase-auth-compat.js`))
    .then(() => {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      firebase.auth().onAuthStateChanged(user => {
        if (!user) {
          const next = encodeURIComponent(window.location.href);
          window.location.replace(`${LOGIN_URL}?next=${next}`);
          return;
        }
        if (!WHITELIST.includes(user.email)) {
          showUnauthorized(user.email);
          return;
        }
        reveal();
      });
    })
    .catch(() => reveal()); // fail open if Firebase CDN is unreachable
})();
