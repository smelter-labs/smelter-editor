import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export function SortableItem(props: any) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: props.id, disabled: props.disableDrag });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    cursor: props.disableDrag ? 'default' : 'grab',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(props.disableDrag ? {} : listeners)}>
      {props.children}
    </div>
  );
}
