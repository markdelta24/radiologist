'use client';

import ReactMarkdown from 'react-markdown';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

interface AnalysisResultsProps {
  results: OverallAnalysis | null;
  isAnalyzing: boolean;
}

interface FrameAnalysis {
  frameNumber: number;
  analysis: string;
  confidence: number;
  findings: string[];
}

interface OverallAnalysis {
  summary: string;
  recommendations: string[];
  urgency: 'low' | 'medium' | 'high';
  frameAnalyses: FrameAnalysis[];
}

function formatSummaryAsMarkdown(summary: string): string {
  // Split into lines and process medical report structure
  const lines = summary.split('\n');
  const formatted: string[] = [];

  // Known radiology report section headings
  const sectionHeadings = [
    'PATIENT INFORMATION',
    'EXAM DATE',
    'EXAM TYPE',
    'CLINICAL HISTORY',
    'TECHNIQUE',
    'COMPARISON',
    'FINDINGS',
    'IMPRESSION',
    'RECOMMENDATION',
    'Patient Information',
    'Exam Date',
    'Exam Type',
    'Clinical History',
    'Technique',
    'Comparison',
    'Findings',
    'Impression',
    'Recommendation'
  ];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) {
      // Preserve blank lines for spacing
      formatted.push('\n');
      continue;
    }

    // Check if this line is a section heading (with or without colon)
    const lineWithoutColon = line.replace(/:$/, '').trim();
    if (sectionHeadings.includes(lineWithoutColon)) {
      formatted.push(`\n## ${lineWithoutColon}\n\n`);
      continue;
    }

    // Major section headings (all caps at start of line)
    if (/^([A-Z\s&]+)(?=\s[A-Z][a-z]|$)/.test(line)) {
      const match = line.match(/^([A-Z\s&]+)(?=\s|$)/);
      if (match) {
        const heading = match[1].trim();
        const rest = line.substring(match[0].length).trim();

        // Only treat as heading if it's a known section or all caps
        if (heading.length > 2 && (
          heading === 'FINDINGS' ||
          heading === 'IMPRESSION' ||
          heading === 'RECOMMENDATION' ||
          heading === 'CLINICAL HISTORY' ||
          heading.split(/\s+/).every(word => word === word.toUpperCase() && word.length > 1)
        )) {
          formatted.push(`\n## ${heading}\n\n`);
          if (rest) {
            formatted.push(rest);
          }
          continue;
        }
      }
    }

    // Numbered sections (1., 2., 3., etc)
    if (/^\d+\.\s*$/.test(line)) {
      formatted.push(`\n**${line}**\n`);
      continue;
    }

    // Bullet points or asterisk lists
    if (/^[*•-]\s/.test(line)) {
      formatted.push(`${line}\n`);
      continue;
    }

    // Bold labels (word followed by colon) - but NOT section headings
    if (!sectionHeadings.includes(lineWithoutColon)) {
      line = line.replace(/^([A-Za-z\s]+):/g, '**$1:**');
    }

    // Add the line
    formatted.push(line + ' ');
  }

  return formatted.join('').trim();
}

export default function AnalysisResults({ results, isAnalyzing }: AnalysisResultsProps) {
  if (isAnalyzing) {
    return (
      <div className="text-center py-6 sm:py-8 px-4">
        <div className="flex flex-col items-center gap-3 sm:gap-4">
          <Spinner className="w-12 h-12 sm:w-16 sm:h-16" />
          <div>
            <h3 className="text-lg sm:text-xl font-semibold text-gray-800 mb-2">
              Analyzing CT Frames with AI...
            </h3>
            <p className="text-sm sm:text-base text-gray-600">
              Please wait while we analyze each frame with Gemini 2.5 Pro
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!results) {
    return null;
  }

  const analysis: OverallAnalysis = results;

  return (
    <div className="max-w-5xl mx-auto space-y-6 px-4 sm:px-6 lg:px-8">
      {/* Main Report Card */}
      <Card className="shadow-xl border-0 overflow-hidden">
        {/* Report Header */}
        <div className="bg-gradient-to-r from-gray-50 to-gray-100 border-b-2 border-blue-600 px-6 sm:px-8 py-4">
          <div className="flex items-center gap-3">
            <div className="w-1 h-8 bg-blue-600 rounded-full"></div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
              RADIOLOGY REPORT
            </h2>
          </div>
        </div>

        {/* Report Content */}
        <CardContent className="px-6 sm:px-8 py-6 sm:py-8 bg-white">
          <div className="font-mono text-sm leading-relaxed">
            <ReactMarkdown
              components={{
                // Section headings - clean text format
                h2: (props) => (
                  <h2
                    className="font-bold text-gray-900 mt-6 mb-2 first:mt-0 uppercase tracking-wide"
                    {...props}
                  />
                ),
                // Subsection headings
                h3: (props) => (
                  <h3
                    className="font-semibold text-gray-800 mt-4 mb-2"
                    {...props}
                  />
                ),
                // Paragraphs - simple spacing
                p: (props) => (
                  <p
                    className="mb-2 text-gray-700 whitespace-pre-wrap"
                    {...props}
                  />
                ),
                // Bold text (labels) - simple bold
                strong: (props) => (
                  <strong
                    className="font-bold text-gray-900"
                    {...props}
                  />
                ),
                // Unordered lists - simple bullets
                ul: (props) => (
                  <ul
                    className="mb-3 space-y-1"
                    {...props}
                  />
                ),
                // List items - simple formatting
                li: (props) => (
                  <li
                    className="text-gray-700"
                    {...props}
                  />
                ),
              }}
            >
              {formatSummaryAsMarkdown(analysis.summary)}
            </ReactMarkdown>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}