# CSS conventions

- Don't touch the global CSS reset living in `../src/assets/reset.css`
- Global custom styles live in `../src/assets/styles.css`
- Style html mostly with scoped style tags in .vue files for CSS
- Exceptions are type scales, colors and often reused css for base styles (e.g. a custom .btn class). Those will be in the global styles.css file.
- Never hard code color in scoped styles. Color variables/tokens live in the global custom styles file and can be referenced. Stylelint enforces this: a raw color literal (hex, `rgb()`/`hsl()`, named colors) fails `lint` everywhere except `../src/assets/styles.css`.
- In scoped style tags preferably use element selectors and nesting. Example:

```css
<style scoped>
ul {
  margin:...;

  li {
    ...;
  }
}
</style>
```

- Don't use BEM if you need to create a custom class for styling
- Avoid using !important
- Use flexible layout primitives such as Grid and Flexbox instead of fixed positioning
- Desing mobile-first and verify that layouts remain usable at narrow and wide viewport sizes
