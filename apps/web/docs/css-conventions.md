# CSS conventions

- Don't touch the global CSS reset living in `../src/assets/reset.css`
- Global custom styles live in `../src/assets/styles.css`
- Style html mostly with scoped style tags in .vue files for CSS
- Exceptions are type scales, colors and often reused css for base styles (e.g. a custom .btn class). Those will be in the global styles.css file.
- Never hard code color in scoped styles. Color variables/tokens live in the global custom styles file and can be referenced. Stylelint enforces this: a raw color literal (hex, `rgb()`/`hsl()`, named colors) fails `lint` everywhere except `../src/assets/styles.css`.
- In scoped style tags preferably use element selectors — keep the markup class-free and let the page structure do the styling. Nest them under their parent so the selector reads as the markup does. Example:

```css
<style scoped>
ul {
  margin-inline: auto;

  li {
    padding-block: var(--space-1);
  }
}

form {
  input[name="item"] {
    flex: 1;
  }
}
</style>
```

- Nest, but stay shallow — two levels at most; a third means the rule wants a class on the element it names. Native nesting is what Vue's scoped transform expects: it puts the scope attribute on each nested selector and Vite flattens the result at build time. Keep one rule per element at the top level (`no-duplicate-selectors` is on), so a variant reads as a nested `&.own`.
- A component's scoped styles may only reach its own markup, so a child never styles its parent's element: a row component that renders its own `li` owns that `li`, and the list above it only owns the `ul`.
- Classes stay in scoped styles for what an element selector cannot say:
  state and variants (`.own`, `.done`, `.no-animate`) and element types that
  repeat without a distinguishing attribute (e.g. one `<p>` beside another —
  prefer an element selector to a positional combinator there).
- Don't use BEM naming conventions
- Avoid using !important
- Use flexible layout primitives such as Grid and Flexbox instead of fixed positioning
- Desing mobile-first and verify that layouts remain usable at narrow and wide viewport sizes
