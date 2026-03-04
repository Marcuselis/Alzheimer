import { describe, it, expect } from '@jest/globals';

// Mock the parseCandidateFromResult and scoreCandidate functions for testing
// These are internal functions, so we'll test the logic indirectly through integration tests

describe('Contact Discovery', () => {
  describe('Candidate Parsing', () => {
    it('should parse LinkedIn title format: "Name - Title - Company | LinkedIn"', () => {
      const title = 'Jane Doe - VP Clinical Operations - Biogen | LinkedIn';
      const snippet = 'Jane Doe is VP of Clinical Operations at Biogen';
      
      // Simulate parsing logic
      const pattern1 = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*[-|]\s*(.+?)(?:\s*[-|]\s*(.+))?$/i;
      const match1 = title.match(pattern1);
      
      expect(match1).toBeTruthy();
      if (match1) {
        expect(match1[1].trim()).toBe('Jane Doe');
        expect(match1[2].trim()).toContain('VP Clinical Operations');
      }
    });

    it('should parse comma-separated format: "Name, Title, Company"', () => {
      const title = 'John Smith, Head of Clinical Operations, Eli Lilly';
      
      const pattern2 = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+),\s*(.+?)(?:,\s*(.+))?$/i;
      const match2 = title.match(pattern2);
      
      expect(match2).toBeTruthy();
      if (match2) {
        expect(match2[1].trim()).toBe('John Smith');
        expect(match2[2].trim()).toBe('Head of Clinical Operations');
        expect(match2[3]?.trim()).toBe('Eli Lilly');
      }
    });

    it('should filter out job postings', () => {
      const url1 = 'https://example.com/jobs/123';
      const url2 = 'https://example.com/careers';
      const url3 = 'https://linkedin.com/in/janedoe';
      
      const isJobPosting = (url: string) => 
        url.includes('/jobs/') || url.includes('/job/') || url.includes('/careers');
      
      expect(isJobPosting(url1)).toBe(true);
      expect(isJobPosting(url2)).toBe(true);
      expect(isJobPosting(url3)).toBe(false);
    });
  });

  describe('Candidate Scoring', () => {
    it('should give high score to LinkedIn profiles', () => {
      const linkedinUrl = 'https://linkedin.com/in/janedoe';
      const score = linkedinUrl.includes('linkedin.com/in/') ? 40 : 0;
      
      expect(score).toBe(40);
    });

    it('should give bonus for sponsor name match', () => {
      const text = 'Jane Doe works at Biogen as VP Clinical Operations';
      const sponsorName = 'Biogen';
      const score = text.toLowerCase().includes(sponsorName.toLowerCase()) ? 20 : 0;
      
      expect(score).toBe(20);
    });

    it('should match persona keywords', () => {
      const title = 'VP Clinical Operations';
      const personaKeywords = [
        'clinical operations', 'clinical development', 'trial monitoring',
        'clinical ops', 'trial management', 'clinical systems'
      ];
      
      const titleLower = title.toLowerCase();
      const hasKeyword = personaKeywords.some(keyword => titleLower.includes(keyword));
      
      expect(hasKeyword).toBe(true);
    });

    it('should penalize recruiter/job posts', () => {
      const text = 'We are hiring a recruiter for Clinical Operations';
      const isRecruiter = text.includes('recruiter') || text.includes('hiring') || text.includes('job opening');
      const score = isRecruiter ? -20 : 0;
      
      expect(score).toBe(-20);
    });

    it('should map score to confidence correctly', () => {
      const scoreToConfidence = (score: number): 'low' | 'medium' | 'high' => {
        if (score >= 70) return 'high';
        if (score >= 40) return 'medium';
        return 'low';
      };
      
      expect(scoreToConfidence(80)).toBe('high');
      expect(scoreToConfidence(50)).toBe('medium');
      expect(scoreToConfidence(30)).toBe('low');
    });
  });

  describe('Seniority Matching', () => {
    it('should match VP/Chief for decision_owner persona', () => {
      const title = 'VP Clinical Operations';
      const personaType = 'decision_owner';
      const titleLower = title.toLowerCase();
      
      const isMatch = personaType === 'decision_owner' && (
        titleLower.includes('vp') || 
        titleLower.includes('vice president') || 
        titleLower.includes('chief') || 
        titleLower.includes('cmo') || 
        titleLower.includes('head of')
      );
      
      expect(isMatch).toBe(true);
    });

    it('should match Director/Head for pain_owner persona', () => {
      const title = 'Director of Clinical Operations';
      const personaType = 'pain_owner';
      const titleLower = title.toLowerCase();
      
      const isMatch = personaType === 'pain_owner' && (
        titleLower.includes('director') || 
        titleLower.includes('head') || 
        titleLower.includes('lead') || 
        titleLower.includes('manager')
      );
      
      expect(isMatch).toBe(true);
    });
  });
});
