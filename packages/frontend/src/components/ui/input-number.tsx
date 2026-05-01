import { NumberField } from '@base-ui/react/number-field';
import type { NumberFieldRootProps } from '@base-ui/react/number-field';
import { MinusIcon, MoveHorizontalIcon, MoveVerticalIcon, PlusIcon } from 'lucide-react';
import { Button } from './button';
import { ButtonGroup } from './button-group';
import { Input } from './input';

function InputNumber({
  orientation = 'horizontal',
  ...props
}: NumberFieldRootProps & {
  orientation?: 'horizontal' | 'vertical';
}) {
  return (
    <NumberField.Root {...props}>
      <NumberField.ScrubArea className="inline-flex">
        <NumberField.ScrubAreaCursor className="rounded-md border border-input bg-popover px-2 py-1 text-ink-600 shadow-sm">
          {orientation === 'horizontal' ? <MoveHorizontalIcon /> : <MoveVerticalIcon />}
        </NumberField.ScrubAreaCursor>
        <NumberField.Group
          className="inline-flex items-stretch"
          render={<ButtonGroup orientation={orientation} />}
        >
          <NumberField.Decrement
            aria-label="Decrease value"
            render={<Button size="icon" variant="outline" />}
          >
            <MinusIcon />
          </NumberField.Decrement>
          <NumberField.Input
            className="h-8 w-16 rounded-none border-x-0 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            readOnly
            render={<Input />}
          />
          <NumberField.Increment
            aria-label="Increase value"
            render={<Button size="icon" variant="outline" />}
          >
            <PlusIcon />
          </NumberField.Increment>
        </NumberField.Group>
      </NumberField.ScrubArea>
    </NumberField.Root>
  );
}

export { InputNumber };
