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
    if (routes[parsed.name]) {
      currentRoute = parsed.name;
      currentParam = parsed.param;
      renderCurrent();
      updateNavActiveState();
    }
  });

  document.querySelectorAll('[data-route]').forEach((el) => {
    el.addEventListener('click', () => navigate(el.getAttribute('data-route')));
  });

  renderCurrent();
  updateNavActiveState();
}

export { registerRoute, navigate, initRouter };
