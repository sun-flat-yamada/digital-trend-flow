# Map-Reduce Architecture Rules

## Never Do
- ❌ Pass full article HTML/Markdown to Gemini Pro
- ❌ Use a single LLM call for the entire day's articles
- ❌ Skip citation URLs at any stage

## Always Do
- ✅ Use Gemini Flash (cheap) for Map phase — extract Facts + URLs
- ✅ Use Gemini Pro (powerful) for Reduce phase — synthesize TOP 1+3
- ✅ Keep each Map input under 10,000 characters
- ✅ Preserve and include source URLs in every output
- ✅ Generate output in Japanese with inline citation links
