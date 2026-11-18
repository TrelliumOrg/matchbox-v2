# UI packages (HTML, React components, Web components, React state management, and similar things)

- Always adhere to WCAG 2.2 AA
- Always use fieldsets instead of divs to contain multiple fields
- Always set up fields as ordered lists of fields from a DOM perspective, without showing that structure in CSS.
- Work as hard as possible to create semantic markup instead of using divs for everything.
- When using a div or span with a single child, consider whether it could be removed and its attributes passed on to the child instead.
- When using a div with relatively simple contents, consider whether a paragraph element would be a better semantic fit.
- Use @tanstack/react-query for all client fetching logic
- Always use kebab-case for CSS class names, string enum or union type values, and any other case where syntax allows for it.

## React Components

- Use function components with explicit return types
- Avoid prop spreading except in UI components
- Use relative imports within modules, absolute for cross-module imports
- Do not add unnecessary comments inside jsx
- Avoid prop drilling - keep state local to components that need it

## Complex UI Components

- Check for existing UI components in `packages/ui` and import UI components using the namespace pattern: `import * as ComponentName from "@matchbox/ui/component-name"`
- Use compound component pattern: split complex components into Root + sub-components
- Export pattern: ComponentName as Root, ComponentSubname as Subname
- Import pattern: import \* as ComponentName from '@matchbox/ui/component-name'
- Usage pattern: <ComponentName.Root><ComponentName.Icon /></ComponentName.Root>
- Always include a Root component as the main container
- Sub-component names should be descriptive: Icon, Trigger, Content, Item, etc.
- React 19: take `ref` as a normal prop; never use forwardRef
- Support polymorphic behavior with as or asChild props where appropriate
- Use tailwind-variants (tv) for complex styling with variants, compound variants, and default variants
- Set display names for all components using constants
- Pass shared props down to sub-components using recursiveCloneChildren utility
- Support className prop for custom styling overrides
- Use Radix UI primitives as the foundation for complex interactive components
