import {
	IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

import mammoth from 'mammoth';
import TurndownService from 'turndown';

export class DocxToMarkdown implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'DOCX → Markdown',
		name: 'docxToMarkdown',
		icon: 'file:markdown.svg',
		group: ['transform'],
		version: 1,
		description: 'Convert a .docx document to Markdown',
		defaults: { name: 'DOCX → Markdown' },
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'The name of the input binary property that contains the .docx file',
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
				description: 'Whether to also include HTML version in the JSON output',
			},
			{
				displayName: 'Preserve Structure',
				name: 'preserveStructure',
				type: 'boolean',
				default: true,
				description: 'Whether to try to preserve headings, lists, and tables',
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
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
			const outputMode = this.getNodeParameter('outputMode', i) as 'json' | 'binary';
			const markdownField = this.getNodeParameter('markdownField', i) as string;
			const includeHtml = this.getNodeParameter('includeHtml', i) as boolean;
			const preserveStructure = this.getNodeParameter('preserveStructure', i) as boolean;
			const outputBinaryProperty = this.getNodeParameter('outputBinaryProperty', i) as string;
			const outputFilename = this.getNodeParameter('outputFilename', i) as string;

			const item = items[i];

			if (!item.binary || !item.binary[binaryPropertyName]) {
				throw new NodeOperationError(
					this.getNode(),
					`Item ${i}: Binary property "${binaryPropertyName}" not found`,
					{ itemIndex: i },
				);
			}

			const inputBinary = item.binary[binaryPropertyName];

			const mime =
				inputBinary.mimeType ??
				'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

			const looksDocx =
				mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
				(inputBinary.fileName?.toLowerCase().endsWith('.docx') ?? false);

			if (!looksDocx) {
				throw new NodeOperationError(
					this.getNode(),
					`Item ${i}: Expected a .docx file (mime="${mime}", name="${inputBinary.fileName ?? 'unknown'}")`,
					{ itemIndex: i },
				);
			}

			const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);

			const mammothOptions = {
				styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"],
				convertImage: mammoth.images.imgElement(async (image) => {
					const buf = await image.read();
					const type = image.contentType || 'image/png';
					const dataUri = `data:${type};base64,${Buffer.from(buf).toString('base64')}`;
					return { src: dataUri };
				}),
			};

			const { value: html, messages } = await mammoth.convertToHtml({ buffer }, mammothOptions);

			// HTML -> Markdown (turndown)
			const td = new TurndownService({
				headingStyle: 'atx',
				bulletListMarker: '-',
				codeBlockStyle: 'fenced',
				emDelimiter: '_',
			});

			if (preserveStructure) {
				td.keep(['table', 'thead', 'tbody', 'tr', 'th', 'td']);
			}

			td.addRule('lineBreaks', {
				filter: ['br'],
				replacement: () => '  \n',
			});

			const markdown = td.turndown(html);
			const warnings = messages?.map((m) => m.message) ?? [];

			if (outputMode === 'json') {
				const json: IDataObject = {
					...item.json,
					[markdownField]: markdown,
					warnings,
				};
				if (includeHtml) (json as IDataObject).html = html;

				returnData.push({ json });
			} else {
				// output binary .md
				const mdBuffer = Buffer.from(markdown, 'utf-8');
				const binary = await this.helpers.prepareBinaryData(
					mdBuffer,
					outputFilename || 'document.md',
					'text/markdown',
				);

				// keep metadata (warnings) in JSON as well
				const json: IDataObject = {
					...item.json,
					warnings,
				};

				returnData.push({
					json,
					binary: {
						[outputBinaryProperty]: binary,
					},
				});
			}
		}

		return [returnData];
	}
}
