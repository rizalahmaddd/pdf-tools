export function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Could not load ${src}. Keep the assets folder next to the HTML file.`));
    document.head.appendChild(s);
  });
}
