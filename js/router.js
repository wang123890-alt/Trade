// Minimal hash-based router. No framework/build step — each route renders
// into #view by calling the view module's render(container) function.

const routes = {};
let currentRoute = 'holdings';

function registerRoute(name, renderFn) {
  routes[name] = renderFn;
}

function navigate(name) {
  if (!routes[name]) return;
  currentRoute = name;
  window.location.hash = name;
  renderCurrent();
  updateNavActiveState();
}

function renderCurrent() {
  const view = document.getElementById('view');
  view.innerHTML = '';
  const render = routes[currentRoute] || routes.holdings;
  render(view);
}

function updateNavActiveState() {
  document.querySelectorAll('[data-route]').forEach((el) => {
    el.classList.toggle('active', el.getAttribute('data-route') === currentRoute);
  });
}

function initRouter() {
  const fromHash = window.location.hash.replace('#', '');
  currentRoute = routes[fromHash] ? fromHash : 'holdings';
  window.addEventListener('hashchange', () => {
    const name = window.location.hash.replace('#', '');
    if (routes[name]) {
      currentRoute = name;
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
