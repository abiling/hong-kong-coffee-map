(() => {
  if (!document.querySelector('#appleMapsButton')) {
    const hiddenAppleLink = document.createElement('a');
    hiddenAppleLink.id = 'appleMapsButton';
    hiddenAppleLink.hidden = true;
    hiddenAppleLink.setAttribute('aria-hidden', 'true');
    document.body.appendChild(hiddenAppleLink);
  }
  const script = document.createElement('script');
  script.src = './admin-core.js';
  script.defer = true;
  document.head.appendChild(script);
})();
