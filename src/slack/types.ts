export interface SlackTextObject {
  type: 'plain_text' | 'mrkdwn';
  text: string;
  emoji?: boolean;
}

export interface SlackHeaderBlock {
  type: 'header';
  text: SlackTextObject;
  block_id?: string;
}

export interface SlackSectionBlock {
  type: 'section';
  text?: SlackTextObject;
  fields?: SlackTextObject[];
  accessory?: SlackButtonElement | SlackImageElement;
  block_id?: string;
}

export interface SlackDividerBlock {
  type: 'divider';
  block_id?: string;
}

export interface SlackContextBlock {
  type: 'context';
  elements: SlackTextObject[];
  block_id?: string;
}

export interface SlackActionsBlock {
  type: 'actions';
  elements: (SlackButtonElement | SlackStaticSelectElement)[];
  block_id?: string;
}

export interface SlackInputBlock {
  type: 'input';
  label: SlackTextObject;
  element: SlackStaticSelectElement | SlackPlainTextInputElement;
  block_id?: string;
  optional?: boolean;
}

export interface SlackButtonElement {
  type: 'button';
  text: SlackTextObject;
  action_id: string;
  url?: string;
  value?: string;
  style?: 'primary' | 'danger';
}

export interface SlackImageElement {
  type: 'image';
  image_url: string;
  alt_text: string;
}

export interface SlackStaticSelectElement {
  type: 'static_select';
  action_id: string;
  placeholder?: SlackTextObject;
  options: SlackOption[];
  initial_option?: SlackOption;
}

export interface SlackPlainTextInputElement {
  type: 'plain_text_input';
  action_id: string;
  placeholder?: SlackTextObject;
  initial_value?: string;
  multiline?: boolean;
}

export interface SlackOption {
  text: SlackTextObject;
  value: string;
}

export type SlackBlock = 
  | SlackHeaderBlock 
  | SlackSectionBlock 
  | SlackDividerBlock 
  | SlackContextBlock 
  | SlackActionsBlock
  | SlackInputBlock;

export interface SlackMessage {
  blocks: SlackBlock[];
  text?: string;
  thread_ts?: string;
  channel?: string;
}

export interface SlackModalView {
  type: 'modal';
  title: SlackTextObject;
  submit?: SlackTextObject;
  close?: SlackTextObject;
  blocks: SlackBlock[];
  private_metadata?: string;
  callback_id: string;
}

export interface SlackInteractionPayload {
  type: 'block_actions' | 'view_submission' | 'shortcut';
  user: {
    id: string;
    username: string;
    name: string;
  };
  trigger_id: string;
  response_url?: string;
  channel?: {
    id: string;
    name: string;
  };
  message?: {
    ts: string;
    thread_ts?: string;
  };
  actions?: Array<{
    action_id: string;
    block_id: string;
    value?: string;
    selected_option?: SlackOption;
  }>;
  view?: {
    id: string;
    callback_id: string;
    private_metadata?: string;
    state?: {
      values: Record<string, Record<string, { selected_option?: SlackOption; value?: string }>>;
    };
  };
}
