import {
	IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

import { htmlToMarkdown } from '../../lib/htmlToMarkdown'; 

export class HtmlToMarkdown implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'HTML → Markdown',
		name: 'htmlToMarkdown',
		icon: 'file:html.svg',
		group: ['transform'],
		version: 1,
		description: 'Convert HTML content to Markdown',
		defaults: { name: 'HTML → Markdown' },
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'Source',
				name: 'source',
				type: 'options',
				options: [
					{ name: 'Binary File', value: 'binary' },
					{ name: 'Text Field', value: 'text' },
				],
				default: 'text',
				description: 'Where to get the HTML input from',
			},
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				displayOptions: { show: { source: ['binary'] } },
				description: 'The name of the input binary property that contains the .html file',
			},
			{
				displayName: 'Text Property',
				name: 'textPropertyName',
				type: 'string',
				default: 'body',
				displayOptions: { show: { source: ['text'] } },
				description: 'The name of the input JSON property containing raw HTML (e.g., "body" for email data)',
			},
			{
				displayName: 'Output Mode',
				name: 'outputMode',
				type: 'options',
				options: [
					{ name: 'JSON (Markdown in Field)', value: 'json' },
					{ name: 'Binary (.md File)', value: 'binary' },
				],
				default: 'json',
			},
			{
				displayName: 'Markdown Field',
				name: 'markdownField',
				type: 'string',
				default: 'markdown',
				displayOptions: { show: { outputMode: ['json'] } },
				description: 'Name of the JSON field to store Markdown',
			},
			{
				displayName: 'Output Binary Property',
				name: 'outputBinaryProperty',
				type: 'string',
				default: 'data',
				displayOptions: { show: { outputMode: ['binary'] } },
				description: 'The binary property to write the .md into',
			},
			{
				displayName: 'Output Filename',
				name: 'outputFilename',
				type: 'string',
				default: 'document.md',
				displayOptions: { show: { outputMode: ['binary'] } },
			},
			// Optional advanced options
			{
				displayName: 'Preserve Tables',
				name: 'preserveTables',
				type: 'boolean',
				default: false,
			},
			{
				displayName: 'Max Length',
				name: 'maxLength',
				type: 'number',
				default: 0,
				description: 'Maximum length of output (0 = no limit)',
			},
			{
				displayName: 'Preserve Line Breaks',
				name: 'preserveLineBreaks',
				type: 'boolean',
				default: false,
			},
		],
	};

	/**
	 * Determines if the given string is HTML content (from an expression) 
	 * vs a property name to look up in the JSON
	 */
	private static isHtmlContent(textPropertyName: string, jsonData: IDataObject): boolean {
		// Must be a string
		if (typeof textPropertyName !== 'string') {
			return false;
		}

		// If it's very short (less than 10 chars), it's likely a property name
		if (textPropertyName.length < 10) {
			return false;
		}

		// If it contains HTML tags, it's likely HTML content
		const hasHtmlTags = /<[^>]+>/.test(textPropertyName);
		
		// If it has HTML tags, check additional criteria to be more confident
		if (hasHtmlTags) {
			// Check if it looks like a complete HTML document or fragment
			const hasCommonHtmlElements = /<(html|head|body|div|p|span|table|ul|ol|li|h[1-6]|a|img|br|hr)/i.test(textPropertyName);
			
			// Check if it has proper HTML structure (opening and closing tags)
			const hasProperStructure = /<[^>]+>.*<\/[^>]+>/.test(textPropertyName);
			
			// If it has HTML tags AND (common elements OR proper structure), it's HTML content
			if (hasCommonHtmlElements || hasProperStructure) {
				return true;
			}
		}

		// Additional check: if it contains HTML entities or common HTML patterns
		const hasHtmlEntities = /&[a-zA-Z0-9#]+;/.test(textPropertyName);
		const hasHtmlAttributes = /=\s*["'][^"']*["']/.test(textPropertyName);
		
		if (hasHtmlEntities || hasHtmlAttributes) {
			return true;
		}

		// If it doesn't look like HTML, check if it's a valid property name
		// Property names are typically short, don't contain HTML, and exist in the JSON
		const isShortPropertyName = textPropertyName.length < 50;
		const isSimplePropertyName = /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(textPropertyName);
		const existsInJson = jsonData && typeof jsonData === 'object' && textPropertyName in jsonData;
		
		// If it looks like a simple property name and exists in JSON, it's probably a property name
		if (isShortPropertyName && isSimplePropertyName && existsInJson) {
			return false;
		}

		// Default: if it's long and contains HTML-like content, treat as HTML
		return textPropertyName.length > 30 && (hasHtmlTags || hasHtmlEntities);
	}

	/**
	 * Gets a nested property from an object using dot notation
	 * e.g., "body.content" -> obj.body.content
	 */
	private static getNestedProperty(obj: any, path: string): any {
		if (!obj || typeof obj !== 'object') {
			return undefined;
		}
		
		const keys = path.split('.');
		let current = obj;
		
		for (const key of keys) {
			if (current === null || current === undefined || typeof current !== 'object') {
				return undefined;
			}
			current = current[key];
		}
		
		return current;
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const source = this.getNodeParameter('source', i) as 'binary' | 'text';
			const outputMode = this.getNodeParameter('outputMode', i) as 'json' | 'binary';
			const markdownField = this.getNodeParameter('markdownField', i) as string;

			let html: string;

			if (source === 'binary') {
				const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
				const item = items[i];
				if (!item.binary?.[binaryPropertyName]) {
					throw new NodeOperationError(
						this.getNode(),
						`Item ${i}: Binary property "${binaryPropertyName}" not found`,
						{ itemIndex: i },
					);
				}
				const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
				html = buffer.toString('utf-8');
			} else {
				const textPropertyName = this.getNodeParameter('textPropertyName', i) as string;
				const item = items[i];
				
				if (!item.json || typeof item.json !== 'object') {
					throw new NodeOperationError(
						this.getNode(),
						`Item ${i}: No JSON data available`,
						{ itemIndex: i },
					);
				}
				
				// Check if textPropertyName is already evaluated HTML content (from expressions like $json.body.content)
				// vs a property name to look up in the JSON
				let actualPropertyUsed: string;
				
				// More robust detection: check if it looks like HTML content
				const looksLikeHtml = HtmlToMarkdown.isHtmlContent(textPropertyName, item.json);
				
				if (looksLikeHtml) {
					// The parameter is already evaluated HTML content
					html = textPropertyName;
					actualPropertyUsed = 'evaluated expression';
				} else {
					// The parameter is a property name, look it up in the JSON
					const availableProperties = Object.keys(item.json);
					let jsonValue = HtmlToMarkdown.getNestedProperty(item.json, textPropertyName);
					actualPropertyUsed = textPropertyName;
					
					// Auto-detection: if the specified property doesn't exist, try common alternatives
					if (jsonValue === undefined || jsonValue === null) {
						const commonProperties = ['html', 'content', 'body', 'text', 'data', 'body.content', 'body.html'];
						const foundProperty = commonProperties.find(prop => {
							const value = HtmlToMarkdown.getNestedProperty(item.json, prop);
							return value !== undefined && 
								value !== null && 
								typeof value === 'string' &&
								value.trim().length > 0;
						});
						
						if (foundProperty) {
							jsonValue = HtmlToMarkdown.getNestedProperty(item.json, foundProperty);
							actualPropertyUsed = foundProperty;
						}
					}
					
					if (jsonValue === undefined || jsonValue === null) {
						// Check if this looks like email data and provide specific guidance
						const isEmailData = availableProperties.some(prop => 
							['body', 'subject', 'sender', 'from', 'toRecipients', 'receivedDateTime'].includes(prop)
						);
						
						const suggestion = isEmailData 
							? '. For email data, try using "body.content", "body.html", or "body" as the Text Property.'
							: '. Try using one of the common properties: html, content, body, text, data, body.content, or body.html.';
						
						throw new NodeOperationError(
							this.getNode(),
							`Item ${i}: Text property "${textPropertyName}" not found${suggestion} Available properties: ${availableProperties.join(', ')}`,
							{ itemIndex: i },
						);
					}
					
					if (typeof jsonValue !== 'string') {
						throw new NodeOperationError(
							this.getNode(),
							`Item ${i}: Text property "${actualPropertyUsed}" must be a string, got ${typeof jsonValue}`,
							{ itemIndex: i },
						);
					}
					
					html = jsonValue;
				}
				
				if (!html.trim()) {
					throw new NodeOperationError(
						this.getNode(),
						`Item ${i}: HTML content is empty`,
						{ itemIndex: i },
					);
				}
			}

			// Options
			const preserveTables = this.getNodeParameter('preserveTables', i) as boolean;
			const maxLength = this.getNodeParameter('maxLength', i) as number;
			const preserveLineBreaks = this.getNodeParameter('preserveLineBreaks', i) as boolean;

		// Convert with error handling
		let markdown: string;
		try {
			markdown = htmlToMarkdown(html, {
				preserveTables,
				maxLength,
				preserveLineBreaks,
			});
		} catch (error) {
			throw new NodeOperationError(
				this.getNode(),
				`Item ${i}: Failed to convert HTML to Markdown: ${error instanceof Error ? error.message : String(error)}`,
				{ itemIndex: i },
			);
		}			if (outputMode === 'json') {
				const json: IDataObject = {
					...items[i].json,
					[markdownField]: markdown,
				};
				returnData.push({ json });
			} else {
				const outputBinaryProperty = this.getNodeParameter('outputBinaryProperty', i) as string;
				const outputFilename = this.getNodeParameter('outputFilename', i) as string;

				const mdBuffer = Buffer.from(markdown, 'utf-8');
				const binary = await this.helpers.prepareBinaryData(
					mdBuffer,
					outputFilename || 'document.md',
					'text/markdown',
				);

				returnData.push({
					json: items[i].json,
					binary: { [outputBinaryProperty]: binary },
				});
			}
		}

		return [returnData];
	}
}
