// card_role_catalog.js
// Shares immutable renderer identifiers with backend creation validation.
// Human labels use the translation catalog; stored protocol values stay stable.
import catalog from '../../../shared/card_roles/catalog.js';

export function isValidCardRole(value) {
    if (typeof value !== 'string') return false;
    if (!value.trim()) return true;
    return value.split(',').every((item) => {
        const [base, modifier, extra] = item.trim().split('+').map((part) => part.trim());
        if (extra !== undefined || (modifier !== undefined && !catalog.modifiers.includes(modifier))) return false;
        return catalog.roles.some((role) => base === role.id
            || (role.numbered && new RegExp(`^${role.id}\\d+$`).test(base)));
    });
}

export function getCardRoleOptions({ includeLegacyVariants = false } = {}) {
    const values = catalog.roles.map((role) => role.id);
    if (includeLegacyVariants) values.push(...catalog.legacy_authoring_values);
    return values.map((value) => {
        const role = catalog.roles.find((item) => value === item.id
            || value.startsWith(item.id + '+')
            || (item.numbered && new RegExp(`^${item.id}\\d`).test(value)));
        const suffix = value.slice(role.id.length);
        return { value, labelKey: suffix ? `card_role_variant_${value.replaceAll('+', '_')}` : role.label_key };
    });
}

export function getCardRoleTranslationFallbacks() {
    const result = Object.fromEntries(catalog.roles.map((role) => [role.label_key, role.labels]));
    for (const value of catalog.legacy_authoring_values) {
        const role = catalog.roles.find((item) => value.startsWith(item.id));
        const number = value.slice(role.id.length).match(/^\d+/)?.[0];
        const isKey = value.includes('+');
        result[`card_role_variant_${value.replaceAll('+', '_')}`] = Object.fromEntries(
            Object.entries(role.labels).map(([lang, label]) => [lang,
                label + (number ? ` ${number}` : '') + (isKey ? ({
                    fi: ' (kieliavain)', en: ' (translation key)', ch: '（翻译键）', yue: '（翻譯鍵）',
                })[lang] : ''),
            ])
        );
    }
    return result;
}
