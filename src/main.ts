import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { ar } from './components/ar/session.svelte';
import { scheduleSession } from './components/planner/session.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('#app is missing from index.html');

const app = mount(App, { target });

/* The verification harness sets window.__GT_TEST__ before the page loads; only then is the test surface
   fetched. It is a separate chunk, so a visitor's bundle never contains it. */
ar.watch();                                      // the sky through the phone, where there is a finger to use it with

if ((window as unknown as { __GT_TEST__?: boolean }).__GT_TEST__) {
  void import('./testing/surface').then(m => m.install());
} else {
  /* A visitor gets the orbit planner when the browser is idle after the first answer: its saved orbits, and the Professor's notes on the
     spacecraft on screen. The test build brings it up itself, before it says it is ready. */
  scheduleSession();
}

export default app;
