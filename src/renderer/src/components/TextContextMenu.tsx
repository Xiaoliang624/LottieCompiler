import { useEffect } from 'react';
import { Menu } from '@tauri-apps/api/menu';

type EditableElement = HTMLInputElement | HTMLTextAreaElement;

function isEditableElement(target: EventTarget | null): target is EditableElement {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

function canEdit(element: EditableElement) {
  return !element.disabled && !element.readOnly && element.type !== 'range';
}

function selectedText(element: EditableElement) {
  const start = element.selectionStart ?? 0;
  const end = element.selectionEnd ?? 0;
  return start === end ? '' : element.value.slice(start, end);
}

function dispatchInput(element: EditableElement) {
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
}

async function copyText(element: EditableElement) {
  const text = selectedText(element);
  if (!text) return;
  await navigator.clipboard.writeText(text);
  element.focus();
}

async function pasteText(element: EditableElement) {
  const text = await navigator.clipboard.readText();
  const start = element.selectionStart ?? element.value.length;
  const end = element.selectionEnd ?? start;
  element.setRangeText(text, start, end, 'end');
  dispatchInput(element);
  element.focus();
}

async function showNativeTextMenu(element: EditableElement) {
  const canCopy = selectedText(element).length > 0;
  const menu = await Menu.new({
    items: [
      {
        id: 'copy',
        text: '复制',
        enabled: canCopy,
        action: () => void copyText(element),
      },
      {
        id: 'paste',
        text: '粘贴',
        action: () => void pasteText(element),
      },
    ],
  });

  await menu.popup();
}

export function TextContextMenu() {
  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      const target = event.target;
      if (!isEditableElement(target) || !canEdit(target)) return;
      void showNativeTextMenu(target);
    };

    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  return null;
}
