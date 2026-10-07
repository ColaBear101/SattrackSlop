import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeUrl } from '../../src/state/url';

/* writeUrl runs after every analysis, and the AR view keeps a history entry of its own while it is open: {ar: 1} in history.state, which Close
   goes back past (history.back()) only if it is still there. An address-bar update that replaced the state with null would leave that entry
   behind, and the Back button would then land on the view's page with the view shut. verification/verify-ar.js checks the entry is gone
   after every way of closing, and rewrites the address under the open view once, in a browser: from an observer that is in the address bar,
   Use my location takes the site out of it. This is the same guard on the line itself, without one. */
describe('writeUrl', () => {
  afterEach(() => vi.unstubAllGlobals());

  const at = (search: string, state: unknown) => {
    const replaceState = vi.fn();
    vi.stubGlobal('location', { pathname: '/', search, hash: '' });
    vi.stubGlobal('history', { state, replaceState });
    return replaceState;
  };

  it('keeps the history entry\'s state when it rewrites the address', () => {
    const replaceState = at('', { ar: 1 });
    writeUrl({ sat: '67683', span: 72, site: { lat: 51.5, lon: -0.12 } }, { span: 24, atHome: false });
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState.mock.calls[0]![0]).toEqual({ ar: 1 });
    expect(replaceState.mock.calls[0]![2]).toBe('/?sat=67683&span=72&site=51.5000%2C-0.1200');
  });

  it('leaves the address and the entry alone when the address is already right', () => {
    const replaceState = at('?sat=67683', { ar: 1 });
    writeUrl({ sat: '67683', span: 24 }, { span: 24, atHome: true });
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('writes no site when there is none to write (a position the device gave is never written)', () => {
    const replaceState = at('?sat=67683&site=51.5000%2C-0.1200', null);
    writeUrl({ sat: '67683', span: 24, site: undefined }, { span: 24, atHome: false });
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState.mock.calls[0]![2]).toBe('/?sat=67683');
  });
});
