# Writing TypeScript

TypeScript should make the app easier to review, not more abstract. Prefer clear object shapes, named exports, and simple types.

## Sources

This guide follows:

- TypeScript Handbook: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
- Google TypeScript Style Guide: https://google.github.io/styleguide/tsguide.html
- typescript-eslint rules: https://typescript-eslint.io/rules/

## Type Style

- Prefer explicit domain types for API data and component props.
- Avoid `any`.
- Use `unknown` when a value must be narrowed.
- Keep generic types rare and obvious.
- Do not use type gymnastics to avoid writing clear code.
- Prefer discriminated unions for state machines.

```ts
type LoadState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'empty' }
  | { status: 'error'; message: string };
```

## Modules

- Use ES module imports and exports.
- Prefer named exports for shared code.
- Keep default exports only where framework conventions require them.
- Use `import type` for type-only imports.
- Avoid barrel files until they clearly improve imports.
- Do not create container classes just to group functions.

## Values

- Use `const` by default.
- Use `let` only when reassignment is needed.
- Never use `var`.
- Prefer plain objects and arrays.
- Avoid mutation unless it is local, obvious, and cheaper to understand than copying.

## Nullability

- Treat `null` and `undefined` deliberately.
- Prefer optional fields for absent values from app code.
- Normalize API responses at the boundary when possible.
- Do not silence errors with non-null assertions unless there is a documented invariant.

## Functions

- Keep function parameters small.
- Prefer an options object when there are more than two related parameters.
- Use names that describe product behavior.
- Avoid boolean parameters when they make call sites unclear.

## API Boundaries

- Define request and response types close to API modules.
- Convert backend wire shapes into app-friendly shapes at the boundary.
- Do not let unvalidated JSON flow deep into UI code.
- Keep date/time and ID handling explicit.

## Tests

- Prefer testing behavior over type implementation details.
- Keep fixtures typed and small.
- Do not over-mock simple functions.
- Use type errors as feedback; do not work around them with assertions.
