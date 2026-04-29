'use client';

import { useCallback, useEffect, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  List,
  ListOrdered,
  Palette,
  Eye,
  Pencil,
  RemoveFormatting,
  ChevronDown,
  Pilcrow,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

const HEADING_OPTIONS: Array<{
  level: HeadingLevel;
  label: string;
  Icon: typeof Heading1;
}> = [
  { level: 1, label: 'Heading 1', Icon: Heading1 },
  { level: 2, label: 'Heading 2', Icon: Heading2 },
  { level: 3, label: 'Heading 3', Icon: Heading3 },
  { level: 4, label: 'Heading 4', Icon: Heading4 },
  { level: 5, label: 'Heading 5', Icon: Heading5 },
  { level: 6, label: 'Heading 6', Icon: Heading6 },
];

type Alignment = 'left' | 'center' | 'right' | 'justify';

const ALIGNMENT_OPTIONS: Array<{
  value: Alignment;
  label: string;
  Icon: typeof AlignLeft;
}> = [
  { value: 'left', label: 'Align left', Icon: AlignLeft },
  { value: 'center', label: 'Align center', Icon: AlignCenter },
  { value: 'right', label: 'Align right', Icon: AlignRight },
  { value: 'justify', label: 'Justify', Icon: AlignJustify },
];

const COLOR_PALETTE = [
  { label: 'White', value: '#ffffff' },
  { label: 'Gray', value: '#a3a3a3' },
  { label: 'Yellow', value: '#facc15' },
  { label: 'Green', value: '#4ade80' },
  { label: 'Sky', value: '#38bdf8' },
  { label: 'Blue', value: '#60a5fa' },
  { label: 'Red', value: '#f87171' },
  { label: 'Purple', value: '#c084fc' },
] as const;

type ToolbarButtonProps = {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  tooltip: string;
  children: React.ReactNode;
};

function ToolbarButton({
  onClick,
  active,
  disabled,
  tooltip,
  children,
}: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type='button'
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
          disabled={disabled}
          className={cn(
            'flex items-center justify-center size-7 rounded transition-colors cursor-pointer',
            active
              ? 'bg-cyan/15 text-cyan'
              : 'text-neutral-400 hover:bg-[#2a2a2a] hover:text-neutral-200',
            disabled && 'opacity-40 pointer-events-none',
          )}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side='bottom'>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function ColorPicker({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const currentColor =
    (editor.getAttributes('textStyle').color as string) || '#ffffff';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type='button'
              onMouseDown={(e) => e.preventDefault()}
              className='flex items-center justify-center size-7 rounded text-neutral-400 hover:bg-[#2a2a2a] hover:text-neutral-200 transition-colors cursor-pointer'>
              <Palette className='size-3.5' />
              <span
                className='absolute bottom-0.5 left-1/2 -translate-x-1/2 h-0.5 w-3 rounded-full'
                style={{ backgroundColor: currentColor }}
              />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side='bottom'>Text color</TooltipContent>
      </Tooltip>
      <PopoverContent className='w-auto p-2' align='start'>
        <div className='grid grid-cols-4 gap-1.5'>
          {COLOR_PALETTE.map((c) => (
            <Tooltip key={c.value}>
              <TooltipTrigger asChild>
                <button
                  type='button'
                  onClick={() => {
                    editor.chain().focus().setColor(c.value).run();
                    setOpen(false);
                  }}
                  className={cn(
                    'size-6 rounded-full border-2 transition-transform hover:scale-110 cursor-pointer',
                    currentColor === c.value
                      ? 'border-cyan'
                      : 'border-transparent',
                  )}
                  style={{ backgroundColor: c.value }}
                />
              </TooltipTrigger>
              <TooltipContent side='bottom'>{c.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
        <button
          type='button'
          onClick={() => {
            editor.chain().focus().unsetColor().run();
            setOpen(false);
          }}
          className='mt-2 flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-neutral-400 hover:bg-[#2a2a2a] hover:text-neutral-200 transition-colors cursor-pointer'>
          <RemoveFormatting className='size-3' />
          Reset color
        </button>
      </PopoverContent>
    </Popover>
  );
}

function HeadingDropdown({
  editor,
  disabled,
}: {
  editor: Editor;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const activeLevel = HEADING_OPTIONS.find((option) =>
    editor.isActive('heading', { level: option.level }),
  )?.level;
  const ActiveIcon = activeLevel
    ? HEADING_OPTIONS.find((option) => option.level === activeLevel)!.Icon
    : Pilcrow;
  const label = activeLevel ? `Heading ${activeLevel}` : 'Paragraph';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type='button'
              onMouseDown={(e) => e.preventDefault()}
              disabled={disabled}
              className={cn(
                'flex items-center gap-0.5 h-7 px-1.5 rounded transition-colors cursor-pointer',
                activeLevel
                  ? 'bg-cyan/15 text-cyan'
                  : 'text-neutral-400 hover:bg-[#2a2a2a] hover:text-neutral-200',
                disabled && 'opacity-40 pointer-events-none',
              )}>
              <ActiveIcon className='size-3.5' />
              <ChevronDown className='size-3 opacity-70' />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side='bottom'>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent className='w-auto p-1' align='start'>
        <div className='flex flex-col gap-0.5'>
          <button
            type='button'
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              editor.chain().focus().setParagraph().run();
              setOpen(false);
            }}
            className={cn(
              'flex items-center gap-2 rounded px-2 py-1 text-xs transition-colors cursor-pointer',
              !activeLevel
                ? 'bg-cyan/15 text-cyan'
                : 'text-neutral-300 hover:bg-[#2a2a2a] hover:text-neutral-100',
            )}>
            <Pilcrow className='size-3.5' />
            Paragraph
          </button>
          {HEADING_OPTIONS.map(({ level, label: optionLabel, Icon }) => (
            <button
              key={level}
              type='button'
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                editor.chain().focus().toggleHeading({ level }).run();
                setOpen(false);
              }}
              className={cn(
                'flex items-center gap-2 rounded px-2 py-1 text-xs transition-colors cursor-pointer',
                activeLevel === level
                  ? 'bg-cyan/15 text-cyan'
                  : 'text-neutral-300 hover:bg-[#2a2a2a] hover:text-neutral-100',
              )}>
              <Icon className='size-3.5' />
              {optionLabel}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Toolbar({
  editor,
  preview,
  onTogglePreview,
}: {
  editor: Editor;
  preview: boolean;
  onTogglePreview: () => void;
}) {
  return (
    <div className='flex items-center gap-0.5 border-b border-[#2a2a2a] px-1 py-1'>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive('bold')}
        disabled={preview}
        tooltip='Bold'>
        <Bold className='size-3.5' />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive('italic')}
        disabled={preview}
        tooltip='Italic'>
        <Italic className='size-3.5' />
      </ToolbarButton>

      <div className='mx-0.5 h-4 w-px bg-[#2a2a2a]' />

      <HeadingDropdown editor={editor} disabled={preview} />

      <div className='mx-0.5 h-4 w-px bg-[#2a2a2a]' />

      {ALIGNMENT_OPTIONS.map(({ value, label, Icon }) => (
        <ToolbarButton
          key={value}
          onClick={() => editor.chain().focus().setTextAlign(value).run()}
          active={editor.isActive({ textAlign: value })}
          disabled={preview}
          tooltip={label}>
          <Icon className='size-3.5' />
        </ToolbarButton>
      ))}

      <div className='mx-0.5 h-4 w-px bg-[#2a2a2a]' />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive('bulletList')}
        disabled={preview}
        tooltip='Bullet list'>
        <List className='size-3.5' />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive('orderedList')}
        disabled={preview}
        tooltip='Ordered list'>
        <ListOrdered className='size-3.5' />
      </ToolbarButton>

      <div className='mx-0.5 h-4 w-px bg-[#2a2a2a]' />

      {!preview && <ColorPicker editor={editor} />}

      <div className='flex-1' />

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            onClick={onTogglePreview}
            className={cn(
              'flex items-center justify-center size-7 rounded transition-colors cursor-pointer',
              preview
                ? 'bg-cyan/15 text-cyan'
                : 'text-neutral-400 hover:bg-[#2a2a2a] hover:text-neutral-200',
            )}>
            {preview ? (
              <Pencil className='size-3.5' />
            ) : (
              <Eye className='size-3.5' />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side='bottom'>
          {preview ? 'Edit' : 'Preview'}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

type RichTextEditorProps = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
};

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
}: RichTextEditorProps) {
  const [preview, setPreview] = useState(false);

  const handleUpdate = useCallback(
    ({ editor }: { editor: Editor }) => {
      const html = editor.getHTML();
      if (html === '<p></p>') {
        onChange('');
      } else {
        onChange(html);
      }
    },
    [onChange],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      TextStyle,
      Color,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
        alignments: ['left', 'center', 'right', 'justify'],
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: value || '',
    editable: !preview,
    onUpdate: handleUpdate,
    editorProps: {
      attributes: {
        class: 'outline-none min-h-[60px] px-2.5 py-2 text-sm text-neutral-200',
      },
    },
  });

  const handleTogglePreview = useCallback(() => {
    setPreview((prev) => {
      const next = !prev;
      editor?.setEditable(!next);
      return next;
    });
  }, [editor]);

  // Keep the editor in sync when `value` changes from outside (e.g. prefill,
  // load-config, reset). tiptap's `useEditor` only reads `content` on mount,
  // so without this effect external updates never reach the document.
  useEffect(() => {
    if (!editor) return;
    const incoming = value || '';
    const current = editor.getHTML();
    const normalizedCurrent = current === '<p></p>' ? '' : current;
    if (incoming === normalizedCurrent) return;
    // Avoid clobbering the user's cursor while they are typing.
    if (editor.isFocused) return;
    editor.commands.setContent(incoming, { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return null;

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          'rounded-md border border-[#2a2a2a] bg-[#141414] overflow-hidden rich-text-editor',
          className,
        )}>
        <Toolbar
          editor={editor}
          preview={preview}
          onTogglePreview={handleTogglePreview}
        />
        <EditorContent editor={editor} />
      </div>
    </TooltipProvider>
  );
}
