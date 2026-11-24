import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const alertVariants = cva('relative w-full rounded-lg border px-4 py-3 text-sm grid gap-0.5', {
  variants: {
    variant: {
      default: 'bg-card text-card-foreground',
      destructive: 'text-destructive bg-card border-destructive/40',
    },
  },
  defaultVariants: { variant: 'default' },
})

function Alert({ className, variant, ...props }) {
  return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
}

function AlertTitle({ className, ...props }) {
  return <div data-slot="alert-title" className={cn('font-medium tracking-tight', className)} {...props} />
}

function AlertDescription({ className, ...props }) {
  return <div data-slot="alert-description" className={cn('text-sm opacity-90', className)} {...props} />
}

export { Alert, AlertTitle, AlertDescription }
