const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

// Получаем переменные окружения
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Проверяем наличие переменных окружения
if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Ошибка: SUPABASE_URL и SUPABASE_ANON_KEY должны быть определены в переменных окружения');
    process.exit(1);
}

module.exports = {
    entry: {
        main: './main_page.js',
        popup: './popup.js',
        background: './background.js',
        dayDetails: './day_details.js'
    },
    output: {
        filename: '[name].bundle.js',
        path: path.resolve(__dirname, 'dist'),
        publicPath: ''
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: [
                            ['@babel/preset-env', {
                                targets: {
                                    browsers: ['last 2 versions', 'not dead']
                                }
                            }]
                        ]
                    }
                }
            },
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader'],
            }
        ]
    },
    plugins: [
        new webpack.DefinePlugin({
            'SUPABASE_URL': JSON.stringify(supabaseUrl),
            'SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey)
        }),
        new HtmlWebpackPlugin({
            template: './index.html',
            filename: 'index.html',
            chunks: ['main']
        }),
        new HtmlWebpackPlugin({
            template: './popup.html',
            filename: 'popup.html',
            chunks: ['popup']
        }),
        new CopyWebpackPlugin({
            patterns: [
                { from: './main_page.css', to: 'main_page.css' },
                { from: './popup.css', to: 'popup.css' },
                { from: './images', to: 'images' },
                { from: './manifest.json', to: 'manifest.json' }
            ],
        }),
    ],
    resolve: {
        extensions: ['.js']
    },
    optimization: {
        minimize: false
    },
    devtool: 'source-map'
}; 