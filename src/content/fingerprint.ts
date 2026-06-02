// Element fingerprinting + resolution, adapted from WebWright's recorder.
// A fingerprint captures multiple ways to re-find an element later so replay
// survives DOM re-renders (React/SPA) where a single CSS selector goes stale.

import type { ElementFingerprint } from '../shared/types';

const AGENT_ATTR = 'data-jidouka-id';

export function getVisibleText(el: Element): string {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim().slice(0, 150);

  let text = '';
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const input = el as HTMLInputElement;
    text = input.value || input.placeholder || '';
  } else if (tag === 'SELECT') {
    const select = el as HTMLSelectElement;
    const selected = select.options[select.selectedIndex];
    text = selected ? selected.text : '';
  } else if (tag === 'IMG') {
    const img = el as HTMLImageElement;
    text = img.alt || img.title || '';
  } else {
    text = ((el as HTMLElement).innerText || el.textContent || '').trim();
  }
  text = text.replace(/\s+/g, ' ').trim().slice(0, 150);

  if (!text) {
    text = (
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      el.getAttribute('alt') ||
      el.getAttribute('value') ||
      el.getAttribute('data-tooltip') ||
      ''
    )
      .trim()
      .slice(0, 150);
  }
  return text;
}

function buildCSSPath(el: Element, maxDepth: number): string {
  const parts: string[] = [];
  let current: Element | null = el;
  for (let d = 0; d < maxDepth && current && current !== document.body; d++) {
    let segment = current.tagName.toLowerCase();
    if (current.id) {
      segment += '#' + CSS.escape(current.id);
      parts.unshift(segment);
      break;
    }
    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children).filter(
        (c) => c.tagName === current!.tagName,
      );
      if (siblings.length > 1) {
        segment += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
    }
    parts.unshift(segment);
    current = current.parentElement;
  }
  return parts.join(' > ');
}

export function buildElementFingerprint(el: Element): ElementFingerprint | null {
  if (!el || !el.getBoundingClientRect) return null;
  const rect = el.getBoundingClientRect();
  const tag = el.tagName.toLowerCase();
  const anyEl = el as HTMLInputElement & HTMLAnchorElement;

  const selectors: ElementFingerprint['selectors'] = {
    id: el.id || null,
    cssPath: buildCSSPath(el, 3),
    dataAttributes: {},
  };
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith('data-') && attr.name !== AGENT_ATTR) {
      selectors.dataAttributes[attr.name] = attr.value;
    }
  }

  let parentText = '';
  if (el.parentElement) parentText = getVisibleText(el.parentElement).slice(0, 100);

  const siblingTexts: string[] = [];
  if (el.parentElement) {
    for (const sib of Array.from(el.parentElement.children)) {
      if (sib !== el) {
        const t = getVisibleText(sib);
        if (t) siblingTexts.push(t.slice(0, 50));
      }
      if (siblingTexts.length >= 5) break;
    }
  }

  return {
    selectors,
    tag,
    text: getVisibleText(el),
    ariaLabel: el.getAttribute('aria-label'),
    placeholder: anyEl.placeholder || null,
    role: el.getAttribute('role'),
    type: anyEl.type || null,
    href: anyEl.href || null,
    bounds: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    },
    parentText,
    siblingTexts,
    inputValue:
      tag === 'input' || tag === 'textarea' || tag === 'select' ? anyEl.value ?? null : null,
  };
}

// Build the best primary selector available from a fingerprint.
export function primarySelector(fp: ElementFingerprint | null | undefined): string {
  if (!fp || !fp.selectors) return '';
  if (fp.selectors.id) return '#' + CSS.escape(fp.selectors.id);
  if (fp.selectors.cssPath) return fp.selectors.cssPath;
  for (const [attr, val] of Object.entries(fp.selectors.dataAttributes)) {
    if (attr !== AGENT_ATTR) return `[${attr}="${CSS.escape(val)}"]`;
  }
  return '';
}

// Score every candidate element against the fingerprint and return the best
// confident match. Used as a replay fallback when the primary selector misses.
export function resolveByFingerprint(fp: ElementFingerprint): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(
    'a, button, input, textarea, select, [role], [tabindex], [onclick], [contenteditable="true"]',
  );

  let bestEl: HTMLElement | null = null;
  let bestScore = 0;

  candidates.forEach((c) => {
    let score = 0;

    if (fp.selectors?.id && c.id === fp.selectors.id) score += 100;
    if (fp.tag && c.tagName.toLowerCase() === fp.tag) score += 10;

    const cText = getVisibleText(c);
    if (fp.text && cText) {
      if (fp.text === cText) score += 40;
      else if (fp.text.toLowerCase() === cText.toLowerCase()) score += 35;
      else if (
        cText.toLowerCase().includes(fp.text.toLowerCase()) ||
        fp.text.toLowerCase().includes(cText.toLowerCase())
      )
        score += 20;
    }

    const cAria = c.getAttribute('aria-label') || '';
    if (fp.ariaLabel && cAria) {
      if (fp.ariaLabel === cAria) score += 35;
      else if (cAria.toLowerCase().includes(fp.ariaLabel.toLowerCase())) score += 20;
    }

    const cPlaceholder = (c as HTMLInputElement).placeholder || '';
    if (fp.placeholder && cPlaceholder) {
      if (fp.placeholder === cPlaceholder) score += 30;
      else if (cPlaceholder.toLowerCase().includes(fp.placeholder.toLowerCase())) score += 15;
    }

    if (fp.role && c.getAttribute('role') === fp.role) score += 8;
    if (fp.type && (c as HTMLInputElement).type === fp.type) score += 8;

    const cHref = (c as HTMLAnchorElement).href || '';
    if (fp.href && cHref) {
      if (fp.href === cHref) score += 25;
      else {
        try {
          if (new URL(fp.href).pathname === new URL(cHref).pathname) score += 15;
        } catch {
          /* ignore bad URLs */
        }
      }
    }

    if (fp.selectors?.dataAttributes) {
      for (const [attr, val] of Object.entries(fp.selectors.dataAttributes)) {
        if (attr !== AGENT_ATTR && c.getAttribute(attr) === val) {
          score += 20;
          break;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestEl = c;
    }
  });

  // Require minimum confidence so we never act on the wrong element.
  return bestScore >= 35 ? bestEl : null;
}
