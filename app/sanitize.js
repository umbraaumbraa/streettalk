import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

let windowObj;
if (typeof window === 'undefined') {
  // We are on the server, create a fake window for DOMPurify
  const { window } = new JSDOM('');
  windowObj = window;
} else {
  // We are in the browser, use the real window
  windowObj = window;
}

const DOMPurify = createDOMPurify(windowObj);

export function sanitize(dirty) {
  return DOMPurify.sanitize(dirty);
}
