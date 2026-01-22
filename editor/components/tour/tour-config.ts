import type { DriveStep } from 'driver.js';
import type { useDriverTour } from './useDriverTour';
import type { AccordionHandle } from '../ui/accordion';

export function handleAccordionHighlightStarted(
  element: any,
  step: any,
  opts: any,
) {
  if (!element) return;
  const thisAccordion = element.closest(
    '[data-accordion="true"]',
  ) as HTMLDivElement;
  const allAccordions = document.querySelectorAll(
    '[data-accordion="true"]',
  ) as NodeListOf<HTMLDivElement>;
  allAccordions.forEach((acc) => {
    if (acc !== thisAccordion && acc.getAttribute('data-open') === 'true') {
      acc.querySelector('button')?.click();
    }
  });

  if (thisAccordion && thisAccordion.getAttribute('data-open') === 'false') {
    thisAccordion.querySelector('button')?.click();
  }
}

export const roomTourSteps: DriveStep[] = [
  {
    element: '[data-tour="video-player-container"]',
    popover: {
      title: 'Adding Streams',
      description:
        'What you see now is a video composed in real time from multiple sources. Hard to believe, right?',
      side: 'bottom',
      align: 'center',
      showButtons: ['next', 'close'],
    },
    onHighlightStarted: (element, step, opts) => {
      const thisAccordion = document.querySelector(
        '[data-tour="twitch-add-input-form-container"]',
      ) as Element;
      if (
        thisAccordion &&
        thisAccordion.getAttribute('data-open') === 'false'
      ) {
        thisAccordion.querySelector('button')?.click();
      }
    },
  },
  {
    element: '[data-tour="twitch-add-input-form-container"] input',
    popover: {
      title: "Let's add some streams!",
      description:
        'You can add streams from Twitch, Kick, or any HLS/WebRTC source.',
      side: 'left',
      align: 'center',
      showButtons: ['close'],
    },
    onHighlightStarted: (element, step, opts) => {
      if (!element) {
        element = document.querySelector(
          '[data-tour="twitch-add-input-form-container"]',
        ) as Element;
      }
    },
  },
  {
    element: '[data-tour="twitch-suggestion-item-container"]',
    popover: {
      title: 'Click to add',
      description: 'Just click on the stream to include it.',
      side: 'left',
      align: 'start',
      showButtons: ['close'],
    },
    onHighlightStarted: handleAccordionHighlightStarted,
  },
  {
    element: '[data-tour="video-player-container"]',
    popover: {
      title: 'Stream is loading...',
      description: 'Please wait a moment while the stream loads...',
      side: 'right',
      align: 'center',
      showButtons: ['close'],
    },
  },
  {
    element: '[data-tour="video-player-container"]',
    popover: {
      title: 'Stream is ready!',
      description: 'Your stream is ready to watch.',
      side: 'bottom',
      align: 'center',
      showButtons: ['next', 'close'],
    },
  },
  {
    element: '[data-tour="tour-launcher-container"]',
    popover: {
      title: "What's next?",
      description:
        'Feel free to explore on your own, or start one of the tours to discover what Smelter can do.',
      side: 'bottom',
      align: 'center',
      showButtons: ['next', 'close'],
    },
  },
];

export const composingTourSteps: DriveStep[] = [
  {
    element: '[data-tour="streams-list-container"]',
    popover: {
      title: 'Composing Videos',
      description:
        'You can compose videos in real time. Simply drag and drop the sources into the positions you want.',
      side: 'bottom',
      align: 'center',
      showButtons: ['close'],
    },
    onHighlightStarted: handleAccordionHighlightStarted,
  },
  {
    element: '[data-tour="streams-list-container"]',
    popover: {
      title: 'Composing Videos',
      description:
        'You can compose videos in real time. Simply drag and drop the sources into the positions you want.',
      side: 'bottom',
      align: 'center',
      showButtons: ['next', 'close'],
    },
    onHighlightStarted: handleAccordionHighlightStarted,
  },
  {
    element: '[data-tour="layout-selector-container"]',
    popover: {
      title: 'Layouts',
      description:
        'You can change the video layout. Just click the layout you want to use.',
      side: 'bottom',
      align: 'center',
      showButtons: ['close'],
    },
    onHighlightStarted: handleAccordionHighlightStarted,
  },
  {
    element: '[data-tour="layout-selector-container"]',
    popover: {
      title: 'Layouts',
      description:
        'You can change the video layout. Just click the layout you want to use.',
      side: 'left',
      align: 'center',
      showButtons: ['next', 'close'],
    },
    onHighlightStarted: handleAccordionHighlightStarted,
  },
  {
    element: '[data-tour="video-player-container"]',
    popover: {
      title: 'Happening in real time!',
      description:
        'Since the video is composed in real time, you can see the results immediately.',
      side: 'bottom',
      align: 'center',
      showButtons: ['next', 'close'],
    },
  },
];

export const shadersTourSteps: DriveStep[] = [
  {
    element: '[data-tour="streams-list-container"]',
    popover: {
      title: 'Using Shaders',
      description:
        'Each video can be enhanced with various shaders. Click the "Add Effects" button to see the available options.',
      side: 'bottom',
      align: 'center',
      showButtons: ['close'],
    },
    onHighlightStarted: handleAccordionHighlightStarted,
  },
  {
    element: '[data-tour="fx-accordion-container"]',
    popover: {
      title: 'Using Shaders',
      description:
        'We’ve prepared some shaders for you, but you can also create your own. Click "Enable" to activate the shader you want.',
      side: 'bottom',
      align: 'center',
      showButtons: ['close'],
    },
    onHighlightStarted: handleAccordionHighlightStarted,
  },
  {
    element: '[data-tour="video-player-container"]',
    popover: {
      title: 'Shader enabled!',
      description:
        'The shader is now active, and you can see the effect immediately.',
      side: 'bottom',
      align: 'center',
      showButtons: ['next', 'close'],
    },
  },
  {
    element: '[data-tour="fx-accordion-container"]',
    popover: {
      title: 'Adjusting Shaders',
      description:
        'Now you can fine-tune the shader parameters. Just move the sliders to get the effect you want.',
      side: 'left',
      align: 'center',
      showButtons: ['next', 'close'],
    },
    onHighlightStarted: handleAccordionHighlightStarted,
  },
];

export const mobileTourSteps: DriveStep[] = [
  {
    element: '.no-existing-element',
    popover: {
      title: 'Better on Desktop',
      description:
        'For a smoother and more comfortable experience, we recommend checking out the desktop version. It provides clearer navigation and access to several configuration options that are limited on mobile.',
      showButtons: ['next', 'close'],
    },
  },
];

export const commonTourOptions: Parameters<typeof useDriverTour>[2] = {
  showProgress: false,
  nextBtnText: 'Next',
  prevBtnText: 'Previous',
  doneBtnText: 'Done',
  stageRadius: 25,
  allowKeyboardControl: false,
};

export const mobileTourOptions: Parameters<typeof useDriverTour>[2] = {
  ...commonTourOptions,
  allowKeyboardControl: true,
};
