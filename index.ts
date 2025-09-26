import type { INodeType, INodeTypeDescription, ICredentialType } from 'n8n-workflow';

// Import your node classes
import { DocxToMarkdown } from './nodes/DocxToMarkdown/DocxToMarkdown.node';
import { HtmlToMarkdown } from './nodes/HtmlToMarkdown/HtmlToMarkdown.node';

// If you add credentials later, import them here
// import { MyApi } from './credentials/MyApi.credentials';

// Export node classes so n8n can load them
export const nodeClasses: INodeType[] = [
	new DocxToMarkdown(),
	new HtmlToMarkdown(),
];

// Export credentials (empty for now)
export const credentials: ICredentialType[] = [];

// Export node descriptions (n8n uses this to display in the UI)
export const nodeDescriptions: INodeTypeDescription[] = nodeClasses.map((n) => n.description);
