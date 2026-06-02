// Generates a reasonably stable, unique CSS selector for an element.
// Preference order: id > data-* test attributes > tag + class + nth-of-type path.

const TEST_ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-qa', 'name'];

function isUnique(selector: string, root: Document | Element = document): boolean {
  try {
    return root.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

function nthOfTypeIndex(el: Element): number {
  let index = 1;
  let sibling = el.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === el.tagName) index++;
    sibling = sibling.previousElementSibling;
  }
  return index;
}

export function buildSelector(el: Element): string {
  if (!(el instanceof Element)) return '';

  // 1. Unique id.
  if (el.id && isUnique(`#${cssEscape(el.id)}`)) {
    return `#${cssEscape(el.id)}`;
  }

  // 2. Test attributes.
  for (const attr of TEST_ATTRS) {
    const val = el.getAttribute(attr);
    if (val) {
      const selector = `${el.tagName.toLowerCase()}[${attr}="${CSS.escape(val)}"]`;
      if (isUnique(selector)) return selector;
    }
  }

  // 3. Build a path from the element up to a stable ancestor.
  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let part = current.tagName.toLowerCase();

    if (current.id && isUnique(`#${cssEscape(current.id)}`)) {
      parts.unshift(`#${cssEscape(current.id)}`);
      break;
    }

    const nth = nthOfTypeIndex(current);
    part += `:nth-of-type(${nth})`;
    parts.unshift(part);

    const candidate = parts.join(' > ');
    if (isUnique(candidate)) return candidate;

    current = current.parentElement;
  }

  return parts.join(' > ');
}
