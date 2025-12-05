# Audio Visualizer

A Three.js-based audio visualizer with particle effects that responds to audio input from microphone or uploaded files.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Run locally:

```bash
npm start
```

The app will be available at `http://localhost:3000`

## Deployment to Vercel

1. Make sure you have the Vercel CLI installed:

```bash
npm i -g vercel
```

2. Deploy:

```bash
vercel
```

Or connect your GitHub repository to Vercel for automatic deployments.

## Project Structure

```
audio/
├── public/          # Static files (HTML, CSS, JS)
│   ├── index.html
│   ├── style.css
│   └── index.js
├── server.js        # Express server
├── package.json     # Dependencies
├── vercel.json      # Vercel configuration
└── README.md
```

## Features

- Real-time audio visualization with particle effects
- Multiple shape options (Spheres, Tetrahedron, Cylinder, Torus, Spiral)
- Microphone input support
- Audio file upload and playback
- Interactive waveform visualization
