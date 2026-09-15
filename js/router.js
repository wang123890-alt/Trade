// Minimal hash-based router. No framework/build step. Supports a single
// optional path parameter after the route name: '#detail/2330' -> routes
// registered as 'detail' receive ('2330') as their second render() arg.

const routes = {};
let currentRoute = 'overview';
let currentParam = null;

function registerRoute(name, renderFn) {
  routes[name] = renderFn;
}

function parseHash() {
  const raw = window.location.hash.replace('#', '');
  const [name, param] = raw.split('/');
  return { name, param: param ?? null };
}

function navigate(name, param = null) {
  if (!routes[name]) return;
  const nextHash = param != null ? `${name}/${param}` : name;
  const hashChanged = window.location.hash.replace('#', '') !== nextHash;

  currentRoute = name;
  currentParam = param;
  window.location.hash = nextHash;

  // Setting location.hash fires 'hashchange' asynchronously, and that
  // listener re-renders too — calling renderCurrent() here as well would
  // render twice for one navigation, orphaning the first render's DOM
  // (any in-flight async work in it, like a chart fetch, would then update
  // a detached node no one sees). Only render synchronously here when the
  // hash didn't actually change (so no 'hashchange' will fire to do it).
  if (!hashChanged) {
    renderCurrent();
    updateNavActiveState();
  }
}

function renderCurrent() {
  const view = document.getElementById('view');
  view.innerHTML = '';
  const render = routes[currentRoute] || routes.overview;
  render(view, currentParam);
}

function updateNavActiveState() {
  document.querySelectorAll('[data-route]').forEach((el) => {
    el.classList.toggle('active', el.getAttribute('data-route') === currentRoute);
  });
}

function initRouter() {
  const { name, param } = parseHash();
  currentRoute = routes[name] ? name : 'overview';
  currentParam = param;

  window.addEventListener('hashchange', () => {
    const parsed = parseHash();
    // A back/swipe gesture can land on the very first history entry, from
    // before any route was ever pushed — its hash is empty, same as a fresh
    // page load with no hash at all. initRouter() already falls back to
    // 'overview' for that case; this listener needs the same fallback, or
    // an empty hash silently does nothing here (routes[''] is undefined),
    // leaving the previous view's DOM on screen with no visible response.
    // The next back gesture then has nowhere left to go within the app and
    // exits it instead — what looked like "swipe back does nothing, so I
    // swiped again" was actually "the first swipe worked but nothing
    // re-rendered to show it".
    currentRoute = routes[parsed.name] ? parsed.name : 'overview';
    currentParam = parsed.param;
    renderCurrent();
    updateNavActiveState();
  });

  document.querySelectorAll('[data-route]').forEach((el) => {
    el.addEventListener('click', () => navigate(el.getAttribute('data-route')));
  });

  renderCurrent();
  updateNavActiveState();
}

export { registerRoute, navigate, initRouter };
