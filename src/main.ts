import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import { mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('#app is missing from index.html');

const app = mount(App, { target });

/* The verification harness sets window.__GT_TEST__ before the page loads; only then is the test surface
   fetched. It is a separate chunk, so a visitor's bundle never contains it. */
if ((window as unknown as { __GT_TEST__?: boolean }).__GT_TEST__) {
  void import('./testing/surface').then(m => m.install());
}

export default app;
