import { cva, type VariantProps } from "class-variance-authority"

const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center rounded-[0.75rem] border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-colors motion-safe:transition-transform outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 motion-safe:active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:left-1/2 [@media(pointer:coarse)]:after:top-1/2 [@media(pointer:coarse)]:after:h-full [@media(pointer:coarse)]:after:w-full [@media(pointer:coarse)]:after:min-h-11 [@media(pointer:coarse)]:after:min-w-11 [@media(pointer:coarse)]:after:-translate-x-1/2 [@media(pointer:coarse)]:after:-translate-y-1/2",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground [a]:hover:bg-primary/80 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-muted text-foreground hover:bg-muted/80 aria-expanded:bg-muted aria-expanded:text-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive-text hover:bg-destructive/20 focus-visible:border-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30",
        link: "text-primary-text underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 gap-2 px-4",
        sm: "h-8 gap-1.5 rounded-[0.5rem] px-3",
        lg: "h-11 gap-2 px-4 text-base",
        "icon-sm": "size-8 rounded-[0.5rem] motion-safe:active:scale-[0.92]",
        icon: "size-10 motion-safe:active:scale-[0.92]",
        "icon-lg": "size-11 motion-safe:active:scale-[0.92]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

type ButtonVariantsProps = VariantProps<typeof buttonVariants>

export { buttonVariants, type ButtonVariantsProps }
