from transformers import AutoModel, AutoTokenizer
import torch
import os
from pdf2image import convert_from_path
from tqdm import tqdm

os.environ["CUDA_VISIBLE_DEVICES"] = '0'
model_name = 'deepseek-ai/DeepSeek-OCR'

print("Loading model...")
tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True, cache_dir="/ssd4/dongbeen/hf_models")
model = AutoModel.from_pretrained(model_name, _attn_implementation='flash_attention_2', trust_remote_code=True, use_safetensors=True, cache_dir="/ssd4/dongbeen/hf_models")
model = model.eval().cuda().to(torch.bfloat16)
print("Model loaded.")

output_dir = 'markdown'
temp_img_path = 'temp_page.jpg'
prompt = "<image>\n<|grounding|>Convert the document to markdown."

if not os.path.exists(output_dir):
    os.makedirs(output_dir)

# Get all PDF files in the data directory
import glob
pdf_files = glob.glob('data/*.pdf')

if not pdf_files:
    print("No PDF files found in ./data directory.")
    exit()

print(f"Found {len(pdf_files)} PDF files to process.")

for pdf_path in pdf_files:
    print(f"\nProcessing: {pdf_path}")
    
    try:
        pages = convert_from_path(pdf_path, dpi=300)
    except Exception as e:
        print(f"Error converting PDF {pdf_path}: {e}")
        continue
    
    full_markdown = ""
    pdf_filename = os.path.splitext(os.path.basename(pdf_path))[0]
    
    print(f"Starting processing for {len(pages)} pages in {pdf_filename}...")
    
    for i, page_image in enumerate(tqdm(pages, desc=f"Pages in {pdf_filename}")):
        # 4-1. Save image to temp file
        page_image.save(temp_img_path, "JPEG")
        
        # 4-2. Model Inference
        # Using settings from previous configuration
        res = model.infer(
            tokenizer, 
            prompt=prompt, 
            image_file=temp_img_path, 
            output_path=output_dir, # Note: this might save intermediate files if save_results=True
            base_size=1024, 
            image_size=640, 
            crop_mode=True, 
            save_results=True,  # Reverted to True as it might be required for return value or file generation
            test_compress=True
        )
        
        # 4-3. Collect results
        page_text = res 
        
        if page_text is None:
            # Fallback: try to read from the expected output file
            # Checking for likely output filenames
            possible_files = [
                os.path.join(output_dir, "temp_page.mmd"),
                os.path.join(output_dir, "temp_page.md"),
                os.path.join(output_dir, "result.mmd"), # Added based on observation
                os.path.join(output_dir, "result.md")
            ]
            
            found_text = False
            for p_file in possible_files:
                if os.path.exists(p_file):
                    with open(p_file, 'r', encoding='utf-8') as f:
                        page_text = f.read()
                    print(f"DEBUG: Found output in {p_file}")
                    found_text = True
                    # Clean up the page file so next iteration doesn't read old data
                    os.remove(p_file) 
                    break
            
            if not found_text:
                print(f"Warning: model.infer returned None and no output file found. Files in {output_dir}: {os.listdir(output_dir)}")
                page_text = ""

        # Add page separator and text
        full_markdown += f"\n\n\n\n"
        full_markdown += page_text

    # 5. Save final markdown for this PDF
    final_md_path = os.path.join(output_dir, f"{pdf_filename}.md")
    with open(final_md_path, "w", encoding="utf-8") as f:
        f.write(full_markdown)

    print(f"Saved markdown to: {final_md_path}")

# 6. Clean up temp file
if os.path.exists(temp_img_path):
    os.remove(temp_img_path)
    
# Clean up potential leftover result files
for p_file in [os.path.join(output_dir, "result.mmd"), os.path.join(output_dir, "result.md")]:
    if os.path.exists(p_file):
        os.remove(p_file)

print("\nAll files processed successfully!")