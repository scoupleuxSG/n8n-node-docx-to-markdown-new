import {
	IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

import { htmlToMarkdown, htmlToMarkdownSimple } from '../../lib/htmlToMarkdown';

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
				displayName: 'Input Mode',
				name: 'inputMode',
				type: 'options',
				options: [
					{ name: 'Text (HTML String)', value: 'text' },
					{ name: 'Binary (HTML File)', value: 'binary' },
				],
				default: 'text',
				description: 'How to provide the HTML content',
			},
			{
				displayName: 'HTML Text',
				name: 'htmlText',
				type: 'string',
				typeOptions: {
					rows: 10,
				},
				default: '',
				displayOptions: { show: { inputMode: ['text'] } },
				description: 'The HTML content to convert',
			},
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				displayOptions: { show: { inputMode: ['binary'] } },
				description: 'The name of the input binary property that contains the HTML file',
			},
			{
				displayName: 'Conversion Mode',
				name: 'conversionMode',
				type: 'options',
				options: [
					{ name: 'Custom Options', value: 'custom' },
					{ name: 'Default Settings', value: 'default' },
				],
				default: 'default',
				description: 'Choose between default settings or custom configuration',
			},
			{
				displayName: 'Preserve Tables',
				name: 'preserveTables',
				type: 'boolean',
				default: false,
				displayOptions: { show: { conversionMode: ['custom'] } },
				description: 'Whether to preserve table structure in the output',
			},
			{
				displayName: 'Include Image Alt Text',
				name: 'includeImageAlt',
				type: 'boolean',
				default: true,
				displayOptions: { show: { conversionMode: ['custom'] } },
				description: 'Whether to include image alt text in the output',
			},
			{
				displayName: 'Preserve Line Breaks',
				name: 'preserveLineBreaks',
				type: 'boolean',
				default: false,
				displayOptions: { show: { conversionMode: ['custom'] } },
				description: 'Whether to preserve line breaks from the original HTML',
			},
			{
				displayName: 'Max Length',
				name: 'maxLength',
				type: 'number',
				default: 0,
				displayOptions: { show: { conversionMode: ['custom'] } },
				description: 'Maximum length of output (0 = no limit)',
			},
			{
				displayName: 'Allowed Domains',
				name: 'allowedDomains',
				type: 'string',
				default: '',
				displayOptions: { show: { conversionMode: ['custom'] } },
				description: 'Comma-separated list of allowed domains for links and images',
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
				displayName: 'Include HTML',
				name: 'includeHtml',
				type: 'boolean',
				default: false,
				displayOptions: { show: { outputMode: ['json'] } },
				description: 'Whether to also include original HTML in the JSON output',
			},
			{
				displayName: 'Output Binary Property',
				name: 'outputBinaryProperty',
				type: 'string',
				default: 'data',
				displayOptions: { show: { outputMode: ['binary'] } },
				description: 'The binary property to write the .md file into',
			},
			{
				displayName: 'Output Filename',
				name: 'outputFilename',
				type: 'string',
				default: 'document.md',
				displayOptions: { show: { outputMode: ['binary'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const inputMode = this.getNodeParameter('inputMode', i) as 'text' | 'binary';
			const conversionMode = this.getNodeParameter('conversionMode', i) as 'custom' | 'default';
			const outputMode = this.getNodeParameter('outputMode', i) as 'json' | 'binary';

			// Only get parameters that are available based on output mode
			let markdownField: string | undefined;
			let includeHtml: boolean | undefined;
			let outputBinaryProperty: string | undefined;
			let outputFilename: string | undefined;

			if (outputMode === 'json') {
				markdownField = this.getNodeParameter('markdownField', i) as string;
				includeHtml = this.getNodeParameter('includeHtml', i) as boolean;
			} else {
				outputBinaryProperty = this.getNodeParameter('outputBinaryProperty', i) as string;
				outputFilename = this.getNodeParameter('outputFilename', i) as string;
			}

			const item = items[i];
			let htmlContent: string;
			let originalHtml: string;

			// Get HTML content based on input mode
			if (inputMode === 'text') {
				htmlContent = this.getNodeParameter('htmlText', i) as string;
				originalHtml = htmlContent;
			} else {
				// Binary mode
				const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;

				if (!item.binary || !item.binary[binaryPropertyName]) {
					throw new NodeOperationError(
						this.getNode(),
						`Item ${i}: Binary property "${binaryPropertyName}" not found`,
						{ itemIndex: i },
					);
				}

				const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
				htmlContent = buffer.toString('utf-8');
				originalHtml = htmlContent;
			}

			// Validate HTML content
			if (!htmlContent || htmlContent.trim() === '') {
				throw new NodeOperationError(
					this.getNode(),
					`Item ${i}: No HTML content provided`,
					{ itemIndex: i },
				);
			}

			// Convert HTML to Markdown based on conversion mode
			let markdown: string;
			let warnings: string[] = [];

			try {
				if (conversionMode === 'default') {
					// Use default settings with htmlToMarkdownSimple
					markdown = htmlToMarkdownSimple(htmlContent);
				} else {
					// Custom mode - get additional options
					const preserveTables = this.getNodeParameter('preserveTables', i) as boolean;
					const includeImageAlt = this.getNodeParameter('includeImageAlt', i) as boolean;
					const preserveLineBreaks = this.getNodeParameter('preserveLineBreaks', i) as boolean;
					const maxLength = this.getNodeParameter('maxLength', i) as number;
					const allowedDomainsStr = this.getNodeParameter('allowedDomains', i) as string;

					const allowedDomains = allowedDomainsStr
						? allowedDomainsStr.split(',').map(domain => domain.trim()).filter(domain => domain)
						: [];

					markdown = htmlToMarkdown(htmlContent, {
						preserveTables,
						includeImageAlt,
						preserveLineBreaks,
						maxLength: maxLength > 0 ? maxLength : undefined,
						allowedDomains: allowedDomains.length > 0 ? allowedDomains : undefined,
					});
				}
			} catch (error) {
				throw new NodeOperationError(
					this.getNode(),
					`Item ${i}: Failed to convert HTML to Markdown: ${error instanceof Error ? error.message : String(error)}`,
					{ itemIndex: i },
				);
			}

			// Prepare output based on output mode
			if (outputMode === 'json') {
				const json: IDataObject = {
					...item.json,
					[markdownField!]: markdown,
					warnings,
				};
				if (includeHtml) {
					(json as IDataObject).html = originalHtml;
				}

				returnData.push({ json });
			} else {
				// Output binary .md file
				const mdBuffer = Buffer.from(markdown, 'utf-8');
				const binary = await this.helpers.prepareBinaryData(
					mdBuffer,
					outputFilename || 'document.md',
					'text/markdown',
				);

				// Keep metadata (warnings) in JSON as well
				const json: IDataObject = {
					...item.json,
					warnings,
				};

				returnData.push({
					json,
					binary: {
						[outputBinaryProperty!]: binary,
					},
				});
			}
		}

		return [returnData];
	}
}
