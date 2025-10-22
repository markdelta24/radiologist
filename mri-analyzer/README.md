# MRI Scan Analyzer

A Next.js web application that analyzes MRI video scans using OpenAI's GPT-5 vision model. Upload a 15-20 second MRI video and get frame-by-frame analysis with AI-powered medical insights.

## Features

- **Video Upload**: Drag-and-drop interface for MRI video files
- **Configurable Frame Extraction**: Choose from 1-10 FPS extraction rates using FFmpeg
- **AI Analysis**: Uses GPT-5 vision model for superior medical image analysis (84.2% MMMU score)
- **Real-time Progress**: Live progress updates during processing
- **Comprehensive Results**: Detailed frame-by-frame analysis with overall summary
- **Medical Recommendations**: AI-generated recommendations and urgency assessment
- **Flexible Analysis**: Adjustable frame rates for different analysis depths and costs

## Prerequisites

Before running this application, make sure you have:

1. **Node.js** (version 18 or higher)
2. **OpenAI API Key** with GPT-5 access

### Video Processing (No External Dependencies Required!)

✅ **No FFmpeg installation needed!** This application uses pure JavaScript video processing libraries that work out of the box:

- **video-thumbnail**: Lightweight frame extraction (primary method)
- **ffmpeg-extract-frames**: Alternative extraction method (fallback)

The app automatically tries multiple methods and uses the first one that works, ensuring maximum compatibility across different systems.

## Setup

1. **Clone and Install Dependencies**
   ```bash
   cd mri-analyzer
   npm install
   ```

2. **Configure Environment Variables**
   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local` and add your OpenAI API key:
   ```
   OPENAI_API_KEY=your_actual_api_key_here
   ```

3. **Get OpenAI API Key**
   - Visit [OpenAI Platform](https://platform.openai.com/api-keys)
   - Create a new API key with GPT-5 access
   - Copy the key to your `.env.local` file

## Running the Application

1. **Start the Development Server**
   ```bash
   npm run dev
   ```

2. **Open in Browser**
   Navigate to [http://localhost:3000](http://localhost:3000)

## Usage

1. **Configure Frame Rate**: Choose your preferred extraction rate:
   - **1 FPS**: Economical (~15-20 frames) - Basic analysis, lower cost
   - **2 FPS**: Balanced (~30-40 frames) - Recommended for most cases
   - **5 FPS**: Detailed (~75-100 frames) - Comprehensive analysis
   - **10 FPS**: Maximum (~150-200 frames) - Exhaustive analysis, higher cost

2. **Upload Video**: Drag and drop or click to select a 15-20 second MRI video file

3. **Processing**: Watch real-time progress as frames are extracted and analyzed

4. **Results**: Review the comprehensive analysis including:
   - Overall summary and urgency assessment
   - Frame-by-frame detailed analysis with GPT-5 insights
   - Medical recommendations
   - Key findings for each frame

## Supported Video Formats

- MP4
- AVI
- MOV
- WMV
- Maximum file size: 100MB

## Technology Stack

- **Frontend**: Next.js 15, React, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes
- **AI**: OpenAI GPT-5 Vision Model
- **Video Processing**: video-thumbnail, ffmpeg-extract-frames
- **File Handling**: Formidable

## Project Structure

```
src/
├── app/
│   ├── api/analyze-video/     # API endpoint for video processing
│   ├── page.tsx               # Main application page
│   └── layout.tsx             # Root layout
├── components/
│   ├── VideoUpload.tsx        # File upload component
│   └── AnalysisResults.tsx    # Results display component
└── types/                     # TypeScript type definitions
```

## Important Notes

## Frame Extraction Rates Explained

The application offers configurable frame extraction rates to balance analysis depth with processing cost and time:

### **Why Different Frame Rates?**

- **1 FPS (Frames Per Second)**: Extracts 1 frame every second
  - **Use Case**: Quick overview, budget-friendly analysis
  - **Cost**: Lowest (~$0.15-0.30 for 15-20 sec video)
  - **Best For**: Initial screening, educational purposes

- **2 FPS (Default)**: Extracts 2 frames every second
  - **Use Case**: Balanced analysis capturing most important changes
  - **Cost**: Moderate (~$0.30-0.60 for 15-20 sec video)
  - **Best For**: Most clinical scenarios, recommended setting

- **5 FPS**: Extracts 5 frames every second
  - **Use Case**: Detailed analysis for complex cases
  - **Cost**: Higher (~$0.75-1.50 for 15-20 sec video)
  - **Best For**: Suspected abnormalities, research

- **10 FPS**: Extracts 10 frames every second
  - **Use Case**: Comprehensive analysis for critical cases
  - **Cost**: Highest (~$1.50-3.00 for 15-20 sec video)
  - **Best For**: Critical diagnoses, academic research

### **GPT-5 Vision Advantages**

- **Medical Excellence**: 84.2% accuracy on MMMU medical benchmarks
- **Superior Analysis**: Above-human performance on time-limited medical tests
- **Advanced Reasoning**: Multi-step thinking for deeper image insights
- **Context Understanding**: 400K token context for comprehensive analysis

⚠️ **Medical Disclaimer**: This application is for educational and research purposes only. GPT-5 analysis should never replace professional medical diagnosis or treatment. Always consult qualified healthcare providers for medical concerns.

## Development

To contribute to this project:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is for educational purposes. Please ensure you comply with all relevant medical data handling regulations and obtain proper permissions before using with real medical data.
