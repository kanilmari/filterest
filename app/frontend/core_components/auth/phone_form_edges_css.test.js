// phone_form_edges_css.test.js
// Pins the phone form edge and heading declarations changed by batch 334.
// Reads auth.css and form.css at their own viewport gates to catch spacing regressions.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { requireNodeDependency } from '../../../server_tools/lib/node_dependency_loader.mjs';

const { parse } = requireNodeDependency('postcss');
const directory = dirname(fileURLToPath(import.meta.url));
const auth = parse(readFileSync(join(directory, 'auth.css'), 'utf8'));
const forms = parse(readFileSync(join(directory, '../../styles/form.css'), 'utf8'));

function phoneDeclarations(stylesheet, width, selector) {
    const declarations = {};
    let found = false;
    stylesheet.walkAtRules('media', media => {
        if (media.params !== `(width <= ${width}px)`) return;
        media.each(rule => {
            if (rule.type !== 'rule' || !rule.selectors.includes(selector)) return;
            found = true;
            rule.walkDecls(declaration => {
                declarations[declaration.prop] = declaration.value;
            });
        });
    });
    expect(found, `Missing ${selector} inside the ${width}px viewport gate`).toBe(true);
    return declarations;
}

test('login forms reach the page edges with a 16px field inset up to 520px', () => {
    expect(phoneDeclarations(auth, 520, '.standalone-login-page .auth-form')).toMatchObject({
        width: 'auto',
        'max-width': 'none',
        'align-self': 'stretch',
        'margin-inline': '-16px',
        'border-inline-width': '0',
        'border-radius': '0',
        'padding-inline': '16px',
    });
});

test('login content stops adding a second inset up to 420px', () => {
    expect(phoneDeclarations(auth, 420, '.standalone-login-page .auth-page-content-card'))
        .not.toHaveProperty('padding');
});

test('login form padding preserves the inherited inline inset up to 420px', () => {
    const declarations = phoneDeclarations(auth, 420, '.standalone-login-page .auth-form');
    expect(declarations).toMatchObject({ 'padding-block': '28px' });
    for (const removed of ['width', 'max-width', 'padding']) {
        expect(declarations).not.toHaveProperty(removed);
    }
});

test('login form children use the full inner width without extra margins up to 420px', () => {
    const children = [
        'h2', 'label', 'input[type="text"]', '.password-wrapper', '.auth-secondary-actions',
        '#otp-section', '#password-reset-section', '.privacy-notice-link', '#submit', '.error',
    ];
    for (const child of children) {
        const declarations = phoneDeclarations(auth, 420, `.standalone-login-page .auth-form > ${child}`);
        expect(declarations).toMatchObject({ width: '100%', 'margin-inline': '0' });
        expect(declarations).not.toHaveProperty('margin-left');
        expect(declarations).not.toHaveProperty('margin-right');
    }
});

test('page form scrollers share the 16px inset up to 700px', () => {
    expect(phoneDeclarations(forms, 700, '.management_forms')).toMatchObject({
        '--management-forms-padding': '16px',
    });
});

test('page forms reach the page edges with a 16px field inset up to 700px', () => {
    expect(phoneDeclarations(forms, 700, '.management_forms > form')).toMatchObject({
        width: 'auto',
        'max-width': 'none',
        'margin-inline': '-16px',
        'padding-inline': '16px',
        'border-radius': '0',
    });
});

test('page form fieldsets stop adding an inner frame up to 700px', () => {
    expect(phoneDeclarations(forms, 700, '.management_forms > form fieldset')).toMatchObject({
        'margin-inline': '0',
        'padding-inline': '0',
        'border-inline-width': '0',
    });
});

test('page headings clear the floating menu up to 700px', () => {
    expect(phoneDeclarations(forms, 700, '.management_forms > :is(h1, h2, h3, h4, h5, h6):first-child'))
        .toMatchObject({
            display: 'flex',
            'align-items': 'center',
            'min-height': '44px',
            'margin-block-start': '-4px',
            'margin-inline-start': '48px',
        });
});
