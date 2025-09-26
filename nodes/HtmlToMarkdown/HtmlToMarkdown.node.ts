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
				default: 'html',
				displayOptions: { show: { source: ['text'] } },
				description: 'The name of the input JSON property containing raw HTML',
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

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const source = this.getNodeParameter('source', i) as 'binary' | 'text';
			const outputMode = this.getNodeParameter('outputMode', i) as 'json' | 'binary';
			const markdownField = this.getNodeParameter('markdownField', i) as string;

			let html: string | undefined;

			if (source === 'binary') {
				const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
				const item = items[i];
				if (!item.binary || !item.binary[binaryPropertyName]) {
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
				html = items[i].json[textPropertyName] as string;
				if (!html) {
					throw new NodeOperationError(
						this.getNode(),
						`Item ${i}: Text property "${textPropertyName}" not found or empty`,
						{ itemIndex: i },
					);
				}
			}

			// Options
			const preserveTables = this.getNodeParameter('preserveTables', i) as boolean;
			const maxLength = this.getNodeParameter('maxLength', i) as number;
			const preserveLineBreaks = this.getNodeParameter('preserveLineBreaks', i) as boolean;

			// Convert
			const markdown = htmlToMarkdown(html, {
				preserveTables,
				maxLength,
				preserveLineBreaks,
			});

			if (outputMode === 'json') {
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
