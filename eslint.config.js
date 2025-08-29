import globals from 'globals';
import js from '@eslint/js';
import {FlatCompat} from '@eslint/eslintrc';
import {fileURLToPath} from 'url';
import path from 'path';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Translate ESLintRC-style configs into flat configs.
const compat = new FlatCompat({
	baseDirectory: __dirname
});

export default [
	// ESLint recommended config
	js.configs.recommended,

	// Base configuration
	{
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				...globals.browser,
				...globals.node
			}
		}
	},

	// Main rules
	{
		rules: {
			'no-console': ['error', {allow: ['error']}],
			'no-debugger': 'warn',
			'no-dupe-args': 'error',
			'no-dupe-keys': 'error',
			'no-duplicate-case': 'error',
			'no-empty': 'error',
			'no-extra-boolean-cast': 'error',
			'no-extra-semi': 'error',
			'no-unreachable': 'error',

			// Best Practices
			'curly': ['error', 'all'],
			'eqeqeq': ['error', 'smart'],
			'no-empty-function': 'error',
			'no-eval': 'error',
			'no-self-compare': 'error',
			'no-useless-return': 'error',

			// Variables
			'no-shadow': 'error',
			'no-unused-vars': 'warn',
			'no-use-before-define': ['error', {'functions': false}],

			// Stylistic Issues
			'array-bracket-spacing': ['error', 'never'],
			'block-spacing': ['error', 'always'],
			'brace-style': ['error', '1tbs', {'allowSingleLine': false}],
			'comma-dangle': ['error', 'never'],
			'comma-spacing': ['error', {'before': false, 'after': true}],
			'indent': ['error', 'tab', {'SwitchCase': 1}],
			'key-spacing': ['error', {'beforeColon': false, 'afterColon': true}],
			'keyword-spacing': ['error', {'before': true, 'after': true}],
			'linebreak-style': ['error', 'unix'],
			'max-len': ['warn', {
				'code': 300,
				'ignoreTemplateLiterals': true,
				'ignoreUrls': true,
				'ignoreStrings': true
			}],
			'no-mixed-spaces-and-tabs': 'error',
			'no-trailing-spaces': 'warn',
			'nonblock-statement-body-position': ['error', 'beside'],
			'object-curly-spacing': ['error', 'never'],
			'quotes': ['error', 'single', {'avoidEscape': true}],
			'semi': ['error', 'always'],
			'space-before-blocks': ['error', 'always'],
			'space-before-function-paren': ['error', {
				'anonymous': 'always',
				'named': 'never',
				'asyncArrow': 'always'
			}],
			'space-in-parens': ['error', 'never'],
			'space-infix-ops': 'error'
		}
	}

];