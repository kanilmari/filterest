# Browser hyphenation

Filterest uses the ISC-licensed engine from [Hyphen 1.14.1](https://github.com/ytiurin/hyphen/tree/dab57f490d7dfdd459fcaae538ab3e006c44ba8b). The engine's UMD wrapper was replaced with an ES module export so a native browser can load it directly. See [the retained ISC license](hyphen-1.14.1-LICENSE.txt).

The two language modules contain the compiled pattern tables from the same release, serialized as ES module data. No other language tables are shipped.

- Finnish patterns 2.2. Copyright (C) 1986, 1988, 1989 Kauko Saarinen. Patterns may be freely distributed. [Upstream Finnish source](https://github.com/ytiurin/hyphen/blob/dab57f490d7dfdd459fcaae538ab3e006c44ba8b/tex/hyph-fi.tex)
- American English patterns 2005-05-30. Copyright (C) 1990, 2004, 2005 Gerard D.C. Kuiken. Copying and distribution of this file, with or without modification, are permitted in any medium without royalty provided the copyright notice and this notice are preserved. [Upstream English source](https://github.com/ytiurin/hyphen/blob/dab57f490d7dfdd459fcaae538ab3e006c44ba8b/tex/hyph-en-us.tex)
