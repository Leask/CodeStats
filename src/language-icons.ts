import data from './icon-data.json';

// Original Simple Icons paths; provenance and artwork terms: third_party/.
const paths: Record<string, string> = data.paths;
const names: Record<string, string> = {
    'javascript/typescript': 'javascript',
    javascript: 'javascript',
    typescript: 'typescript',
    python: 'python',
    'markdown/text': 'markdown',
    markdown: 'markdown',
    shell: 'gnubash',
    'c/c++': 'cplusplus',
    c: 'c',
    'c++': 'cplusplus',
    'html/css': 'html5',
    html: 'html5',
    css: 'css',
    'json/yaml/toml/ini': 'json',
    go: 'go',
    php: 'php',
    rust: 'rust',
    swift: 'swift',
    kotlin: 'kotlin',
    ruby: 'ruby',
    dockerfile: 'docker',
    lua: 'lua',
    r: 'r',
    zig: 'zig',
};

export const LANGUAGE_ICONS: Record<string, string> = {
    ...Object.fromEntries(Object.entries(names).map(([name, slug]) =>
        [name, paths[slug]])),
    // Neutral symbols for categories that do not have one language logo.
    shaders: 'M12 2 14.5 9.5 22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z',
    sql: 'M12 2C6.5 2 3 3.6 3 6v12c0 2.4 4.5 4 9 4s9-1.6 9-4V6'
        + 'c0-2.4-4.5-4-9-4Zm0 2c4.4 0 7 1.3 7 2s-2.6 2-7 2-7-1.3-7-2'
        + ' 2.6-2 7-2ZM5 8.6c1.8.9 4.4 1.4 7 1.4s5.2-.5 7-1.4V12'
        + 'c0 .7-2.6 2-7 2s-7-1.3-7-2ZM5 14.6c1.8.9 4.4 1.4 7 1.4'
        + 's5.2-.5 7-1.4V18c0 .7-2.6 2-7 2s-7-1.3-7-2Z',
    others: 'M5 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm7 0a2 2 0 1 0 0 4'
        + ' 2 2 0 0 0 0-4Zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
    _fallback: 'M8.6 5.6 2.2 12l6.4 6.4L10 17l-5-5 5-5Z'
        + 'M15.4 5.6 14 7l5 5-5 5 1.4 1.4 6.4-6.4Z',
};

/** Pure lookup also embedded in the preview; no network or unsafe markup. */
export function languageIcon(name: string, icons: Record<string, string>): string {
    const key = name.trim().toLowerCase();
    return Object.hasOwn(icons, key) ? icons[key] : icons._fallback;
}
